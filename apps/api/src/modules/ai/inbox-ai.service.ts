import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { enforceAiRateLimit } from './rate-limit.util';

/**
 * On-demand AI helpers for the /inbox view: thread summarization + reply
 * drafting. Stateless — nothing is persisted; both endpoints just return text.
 *
 * Threading: InboxMessage carries `inReplyTo` (single parent) and
 * `referenceIds` (full chain). We collect every message in the same org
 * whose `messageId` appears in either `referenceIds + [inReplyTo]` of the
 * subject message, OR whose `referenceIds + [inReplyTo]` references the
 * subject message's `messageId`. That gets the whole tree without recursion.
 */

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS_SUMMARY = 600;
const MAX_TOKENS_DRAFT = 700;

// Per-message body cap before we hand it to the model. Long marketing or
// quoted-trail emails can easily blow past 50KB; 6KB per message is plenty
// for a TL;DR. Total prompt is also capped (THREAD_PROMPT_CAP_CHARS).
const PER_MESSAGE_CAP_CHARS = 6_000;
const THREAD_PROMPT_CAP_CHARS = 24_000;
// Hard cap on number of thread mates to include — pathological reply-all
// chains can have hundreds of messages.
const MAX_THREAD_MESSAGES = 20;

const SUMMARY_SYSTEM =
  'You summarize email threads for a CRM user. Output 3-5 bullet points (one bullet per line, prefix with "- "). Focus on what was asked, what was decided, and any open questions or actions needed. No preamble, no closing remark — just the bullets.';

export type DraftIntent =
  | 'reply'
  | 'decline'
  | 'followup'
  | 'request-more-info';

export type DraftTone = 'friendly' | 'professional' | 'concise';

export const DRAFT_INTENTS: DraftIntent[] = [
  'reply',
  'decline',
  'followup',
  'request-more-info',
];
export const DRAFT_TONES: DraftTone[] = ['friendly', 'professional', 'concise'];

const INTENT_LABEL: Record<DraftIntent, string> = {
  reply: 'reply',
  decline: 'polite decline',
  followup: 'follow-up',
  'request-more-info': 'request for more information',
};

interface ThreadMessageRow {
  id: string;
  messageId: string;
  inReplyTo: string | null;
  referenceIds: string[];
  fromEmail: string;
  fromName: string | null;
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  receivedAt: Date;
}

@Injectable()
export class InboxAiService {
  private readonly logger = new Logger(InboxAiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  // ─── Public API ────────────────────────────────────────────────────

  async summarizeThread(args: {
    userId: string;
    orgId: string;
    messageId: string;
  }): Promise<{ summary: string }> {
    const apiKey = this.requireApiKey();
    enforceAiRateLimit(args.userId);

    const thread = await this.loadThread(args.orgId, args.messageId);
    const userPrompt = this.buildThreadPrompt(thread);

    const summary = await this.callAnthropic({
      apiKey,
      system: SUMMARY_SYSTEM,
      user: userPrompt,
      maxTokens: MAX_TOKENS_SUMMARY,
    });

    return { summary };
  }

  async draftReply(args: {
    userId: string;
    orgId: string;
    userDisplayName: string | null;
    messageId: string;
    intent?: DraftIntent;
    tone?: DraftTone;
  }): Promise<{ draft: string; suggestedSubject?: string }> {
    const intent: DraftIntent = args.intent ?? 'reply';
    const tone: DraftTone = args.tone ?? 'professional';

    if (!DRAFT_INTENTS.includes(intent)) {
      throw new BadRequestException(`Invalid intent "${intent}"`);
    }
    if (!DRAFT_TONES.includes(tone)) {
      throw new BadRequestException(`Invalid tone "${tone}"`);
    }

    const apiKey = this.requireApiKey();
    enforceAiRateLimit(args.userId);

    const thread = await this.loadThread(args.orgId, args.messageId);
    const latest = thread[thread.length - 1] ?? thread[0];

    const signature = (args.userDisplayName ?? '').trim() || 'the user';
    const system = `You draft replies to emails on behalf of a CRM user. Draft a ${INTENT_LABEL[intent]} in a ${tone} tone. Sign as ${signature}. Return ONLY the body text — no subject line, no greeting headers like "Hi" or "Hello team," (a simple opening line is fine), no quoted previous messages.`;

    const userPrompt = this.buildThreadPrompt(thread);

    const draft = await this.callAnthropic({
      apiKey,
      system,
      user: userPrompt,
      maxTokens: MAX_TOKENS_DRAFT,
    });

    return {
      draft,
      suggestedSubject: latest?.subject ? prefixReply(latest.subject) : undefined,
    };
  }

  // ─── Thread loading ────────────────────────────────────────────────

  private async loadThread(
    orgId: string,
    messageId: string,
  ): Promise<ThreadMessageRow[]> {
    return this.prisma.withOrganization(orgId, async (tx: any) => {
      const root: ThreadMessageRow | null = await tx.inboxMessage.findFirst({
        where: { id: messageId, organizationId: orgId },
        select: {
          id: true,
          messageId: true,
          inReplyTo: true,
          referenceIds: true,
          fromEmail: true,
          fromName: true,
          subject: true,
          bodyText: true,
          bodyHtml: true,
          receivedAt: true,
        },
      });
      if (!root) throw new NotFoundException('Inbox message not found');

      // Set of RFC822 Message-IDs that identify this thread. Start from the
      // root's references + parent + self, then expand to anything that
      // references the root. One extra round-trip is enough for v1.
      const rootRefs = new Set<string>([
        ...(root.referenceIds ?? []),
        ...(root.inReplyTo ? [root.inReplyTo] : []),
        root.messageId,
      ]);

      // Anything in the same org that mentions any of the root's refs OR
      // mentions the root's own messageId.
      const candidates: ThreadMessageRow[] = await tx.inboxMessage.findMany({
        where: {
          organizationId: orgId,
          OR: [
            { messageId: { in: Array.from(rootRefs) } },
            { inReplyTo: { in: Array.from(rootRefs) } },
            { referenceIds: { hasSome: Array.from(rootRefs) } },
          ],
        },
        orderBy: { receivedAt: 'asc' },
        take: MAX_THREAD_MESSAGES,
        select: {
          id: true,
          messageId: true,
          inReplyTo: true,
          referenceIds: true,
          fromEmail: true,
          fromName: true,
          subject: true,
          bodyText: true,
          bodyHtml: true,
          receivedAt: true,
        },
      });

      // Dedup + ensure root is included (in case the predicate missed it).
      const byId = new Map<string, ThreadMessageRow>();
      for (const m of candidates) byId.set(m.id, m);
      byId.set(root.id, root);

      const ordered = Array.from(byId.values()).sort(
        (a, b) => a.receivedAt.getTime() - b.receivedAt.getTime(),
      );
      return ordered.slice(0, MAX_THREAD_MESSAGES);
    });
  }

  // ─── Prompt building ───────────────────────────────────────────────

  private buildThreadPrompt(thread: ThreadMessageRow[]): string {
    const blocks: string[] = [];
    let total = 0;

    for (const m of thread) {
      const sender = m.fromName?.trim()
        ? `${m.fromName.trim()} <${m.fromEmail}>`
        : m.fromEmail;
      const subject = m.subject?.trim() || '(no subject)';
      const body = pickBody(m.bodyText, m.bodyHtml).slice(
        0,
        PER_MESSAGE_CAP_CHARS,
      );
      const block = [
        `From: ${sender}`,
        `Date: ${m.receivedAt.toISOString()}`,
        `Subject: ${subject}`,
        '',
        body,
      ].join('\n');

      if (total + block.length > THREAD_PROMPT_CAP_CHARS) {
        blocks.push(
          '\n[...older messages truncated to keep the prompt within budget...]',
        );
        break;
      }
      blocks.push(block);
      total += block.length;
    }

    return blocks.join('\n\n---\n\n');
  }

  // ─── Anthropic call ────────────────────────────────────────────────

  private requireApiKey(): string {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'AI features are not configured by your administrator',
      );
    }
    return apiKey;
  }

  private async callAnthropic(args: {
    apiKey: string;
    system: string;
    user: string;
    maxTokens: number;
  }): Promise<string> {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': args.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: args.maxTokens,
          system: args.system,
          messages: [{ role: 'user', content: args.user }],
        }),
      });

      if (!res.ok) {
        const detail = await safeReadText(res);
        this.logger.warn(
          `Anthropic returned ${res.status}: ${detail.slice(0, 300)}`,
        );
        throw new ServiceUnavailableException(
          'AI service is temporarily unavailable',
        );
      }

      const data: any = await res.json();
      const text =
        Array.isArray(data?.content) && typeof data.content[0]?.text === 'string'
          ? data.content[0].text.trim()
          : '';

      if (!text) {
        this.logger.warn('Anthropic returned empty content');
        throw new ServiceUnavailableException(
          'AI service is temporarily unavailable',
        );
      }
      return text;
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.error(
        `Inbox AI call failed: ${(err as Error).message ?? err}`,
      );
      throw new ServiceUnavailableException(
        'AI service is temporarily unavailable',
      );
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

function pickBody(bodyText: string | null, bodyHtml: string | null): string {
  if (bodyText && bodyText.trim()) return bodyText.trim();
  if (bodyHtml && bodyHtml.trim()) return stripHtml(bodyHtml).trim();
  return '(empty body)';
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
}

function prefixReply(subject: string): string {
  const trimmed = subject.trim();
  if (/^re:/i.test(trimmed)) return trimmed;
  return `Re: ${trimmed}`;
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
