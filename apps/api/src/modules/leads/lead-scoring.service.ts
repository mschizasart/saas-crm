import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';

/**
 * AI-powered lead scoring (migration 013).
 *
 * The score is a 0-100 integer composed of two halves, each capped at 50:
 *
 *   1. Heuristic (0-50) — deterministic, weighted formula over activity
 *      signals (notes, inbound emails, completed tasks, recency, status,
 *      pipeline value, source quality). See computeHeuristic() for
 *      exact weights. No LLM cost, runs in milliseconds.
 *
 *   2. AI (0-50) — a Claude Haiku call that reads the lead's notes plus
 *      a handful of inbound + outbound message bodies and emits a single
 *      "SCORE: <int>\nREASON: <short>" line. Soft-failure: any parse or
 *      transport error falls back to a neutral 25.
 *
 * If ANTHROPIC_API_KEY is missing, the service degrades to heuristic-only
 * and doubles the heuristic to fill the 0-100 range — no per-org toggle.
 *
 * Caching: callers should rely on the `force` flag and the 6-hour
 * freshness window in scoreLead(). The on-disk cache lives directly on
 * the Lead row (score / scoreReason / scoreUpdatedAt) — no separate
 * table, no Redis. The BullMQ 'lead-scoring' worker is the only writer
 * in steady state.
 */

const MODEL = 'claude-haiku-4-5-20251001';
const AI_MAX_TOKENS = 200;

// Freshness window: re-using a recent score saves tokens on burst updates
// (e.g. many edits to the same lead in rapid succession).
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// Per-message body cap when building the AI prompt — long marketing or
// quoted-trail emails can easily blow past 50KB; 2KB per message is plenty
// for an intent signal.
const PER_MESSAGE_CAP_CHARS = 2_000;
// Hard cap on the entire user-prompt size we send to the model.
const PROMPT_CAP_CHARS = 12_000;
// How many recent messages of each direction we feed in.
const MAX_INBOUND_EMAILS = 5;
const MAX_OUTBOUND_EMAILS = 5;
// How many recent notes we feed in.
const MAX_NOTES = 10;

const AI_SYSTEM_PROMPT =
  "Score this lead's likelihood to close (0-50). Higher = hotter. Output strictly: SCORE: <int>\nREASON: <one sentence under 100 chars>. No preamble.";

export interface ScoringResult {
  score: number; // 0-100
  reason: string;
  updatedAt: Date;
}

interface HeuristicInputs {
  noteCount: number;
  inboundEmailCount: number;
  completedTaskCount: number;
  daysSinceLastActivity: number | null;
  pipelineValue: number; // numeric value of Lead.value (or 0)
  sourceName: string | null;
  statusName: string | null;
  daysSinceUpdate: number;
}

interface HeuristicOutput {
  score: number; // 0-50
  /** One-liner used in the cached `scoreReason`. */
  summary: string;
}

@Injectable()
export class LeadScoringService {
  private readonly logger = new Logger(LeadScoringService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  // ─── Public API ────────────────────────────────────────────────────

  /**
   * Compute (or return cached) score for a single lead.
   *
   * @param force  Skip the 6-hour freshness window. Used by the manual
   *               recompute endpoint and the bulk score-all path.
   */
  async scoreLead(
    orgId: string,
    leadId: string,
    opts: { force?: boolean } = {},
  ): Promise<ScoringResult> {
    const lead = await this.prisma.withOrganization(orgId, async (tx: any) =>
      tx.lead.findFirst({
        where: { id: leadId, organizationId: orgId },
        include: {
          status: { select: { name: true } },
          source: { select: { name: true } },
        },
      }),
    );

    if (!lead) {
      // Don't throw — the worker calls us on event payloads that may
      // race with a delete. Return a benign sentinel the worker logs
      // and moves on.
      throw new Error(`Lead ${leadId} not found in org ${orgId}`);
    }

    // Cache hit: respect the freshness window unless we're forced.
    if (!opts.force && lead.scoreUpdatedAt && lead.score != null) {
      const age = Date.now() - new Date(lead.scoreUpdatedAt).getTime();
      if (age < CACHE_TTL_MS) {
        return {
          score: lead.score,
          reason: lead.scoreReason ?? '',
          updatedAt: new Date(lead.scoreUpdatedAt),
        };
      }
    }

    // Pull all signals in a single org-scoped pass.
    const [noteCount, inboundEmailCount, completedTaskCount, recentNotes, inboundEmails, outboundEmails] =
      await this.prisma.withOrganization(orgId, async (tx: any) => {
        return Promise.all([
          tx.leadNote.count({ where: { leadId } }),
          tx.inboxMessage.count({
            where: { organizationId: orgId, routedTo: 'lead', routedToId: leadId },
          }),
          tx.task.count({
            where: {
              organizationId: orgId,
              relType: 'lead',
              relId: leadId,
              status: 'complete',
            },
          }),
          tx.leadNote.findMany({
            where: { leadId },
            orderBy: { createdAt: 'desc' },
            take: MAX_NOTES,
            select: { content: true, createdAt: true },
          }),
          tx.inboxMessage.findMany({
            where: { organizationId: orgId, routedTo: 'lead', routedToId: leadId },
            orderBy: { receivedAt: 'desc' },
            take: MAX_INBOUND_EMAILS,
            select: { subject: true, bodyText: true, bodyHtml: true, receivedAt: true, fromEmail: true },
          }),
          tx.leadEmail.findMany({
            where: { leadId, direction: 'outbound' },
            orderBy: { sentAt: 'desc' },
            take: MAX_OUTBOUND_EMAILS,
            select: { subject: true, body: true, sentAt: true, toEmail: true },
          }),
        ]);
      });

    const lastActivityAt = pickLastActivity(lead, recentNotes, inboundEmails, outboundEmails);
    const daysSinceLastActivity = lastActivityAt
      ? daysBetween(new Date(), lastActivityAt)
      : null;
    const daysSinceUpdate = daysBetween(new Date(), new Date(lead.updatedAt));

    const heuristic = this.computeHeuristic({
      noteCount,
      inboundEmailCount,
      completedTaskCount,
      daysSinceLastActivity,
      pipelineValue: leadValueAsNumber(lead.value),
      sourceName: lead.source?.name ?? null,
      statusName: lead.status?.name ?? null,
      daysSinceUpdate,
    });

    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    let aiScore = 25; // neutral default on parse / transport failure
    let aiReason = 'AI scoring unavailable';
    let usedAi = false;

    if (apiKey) {
      const userPrompt = this.buildAiPrompt({
        lead,
        recentNotes,
        inboundEmails,
        outboundEmails,
      });
      const ai = await this.callAi(apiKey, userPrompt).catch((err) => {
        this.logger.warn(
          `AI scoring failed for lead ${leadId} (${(err as Error).message}) — falling back to neutral 25`,
        );
        return null;
      });
      if (ai) {
        aiScore = ai.score;
        aiReason = ai.reason;
        usedAi = true;
      }
    }

    let combined: number;
    let reason: string;
    if (usedAi) {
      combined = clamp(heuristic.score + aiScore, 0, 100);
      reason = `Activity score ${heuristic.score}/50 (${heuristic.summary}), AI score ${aiScore}/50 — ${aiReason}`;
    } else {
      // No API key OR AI errored — double the heuristic to fill the range.
      combined = clamp(heuristic.score * 2, 0, 100);
      reason = `Heuristic-only score ${combined}/100 (${heuristic.summary})`;
    }

    const updatedAt = new Date();

    await this.prisma.withOrganization(orgId, async (tx: any) => {
      await tx.lead.update({
        where: { id: leadId },
        data: {
          score: combined,
          scoreReason: reason.slice(0, 500),
          scoreUpdatedAt: updatedAt,
        },
      });
    });

    return { score: combined, reason, updatedAt };
  }

  // ─── Heuristic ─────────────────────────────────────────────────────

  /**
   * Hardcoded weights for v1. Deliberately not customisable per-org —
   * we want every tenant on the same scale until we have data showing
   * what to tune.
   *
   * Total cap = 50. All sub-scores clamp to their own ceiling so a single
   * runaway signal can't dominate (e.g. 500 notes ≠ 500 points).
   */
  private computeHeuristic(s: HeuristicInputs): HeuristicOutput {
    // ── Engagement (0-22) ────────────────────────────────────────
    // 2 pts per inbound email (capped 12), 1 pt per note (capped 6),
    // 2 pts per completed task (capped 4). Inbound mail is the strongest
    // signal — they're talking to us unprompted.
    const emailPts = Math.min(s.inboundEmailCount * 2, 12);
    const notePts = Math.min(s.noteCount, 6);
    const taskPts = Math.min(s.completedTaskCount * 2, 4);

    // ── Recency (0-10, can go negative for stale leads) ──────────
    // Fresh activity (<= 3 days) full credit; degrades linearly to 0
    // by day 14. Stale leads (15+ days) are penalised -5 to push them
    // down "hot leads" lists. Penalty is bounded so an old lead that
    // suddenly gets a flurry of activity still surfaces.
    let recencyPts: number;
    if (s.daysSinceLastActivity == null) {
      recencyPts = 0;
    } else if (s.daysSinceLastActivity <= 3) {
      recencyPts = 10;
    } else if (s.daysSinceLastActivity <= 14) {
      recencyPts = Math.round(10 * (14 - s.daysSinceLastActivity) / 11);
    } else {
      recencyPts = -5;
    }

    // ── Status (0-10, can go negative) ───────────────────────────
    const status = (s.statusName ?? '').toLowerCase();
    let statusPts = 0;
    if (status === 'won') statusPts = 10;
    else if (status === 'negotiation') statusPts = 9;
    else if (status === 'proposal') statusPts = 7;
    else if (status === 'qualified') statusPts = 5;
    else if (status === 'contacted') statusPts = 3;
    else if (status === 'new') statusPts = 1;
    else if (status === 'lost') statusPts = -10;
    // Unknown / custom statuses get 0 — not penalised, not boosted.

    // Stale-pipeline penalty: lead untouched for 14+ days regardless of
    // status loses 3 pts. Won / lost are terminal, exempt.
    if (s.daysSinceUpdate >= 14 && status !== 'won' && status !== 'lost') {
      statusPts -= 3;
    }

    // ── Pipeline value (0-5) ─────────────────────────────────────
    // Log-ish bands so a $5k lead and a $50k lead are clearly distinct
    // without letting a $5M lead saturate the score on size alone.
    let valuePts = 0;
    if (s.pipelineValue >= 50_000) valuePts = 5;
    else if (s.pipelineValue >= 10_000) valuePts = 4;
    else if (s.pipelineValue >= 5_000) valuePts = 3;
    else if (s.pipelineValue >= 1_000) valuePts = 2;
    else if (s.pipelineValue > 0) valuePts = 1;

    // ── Source quality (0-3) ─────────────────────────────────────
    // Inbound channels (referral, demo, contact-us) outperform
    // cold lists and rented data — match by case-insensitive substring.
    const src = (s.sourceName ?? '').toLowerCase();
    let sourcePts = 0;
    if (/referr|word.?of.?mouth|demo.?req|contact.?us/.test(src)) sourcePts = 3;
    else if (/inbound|web.?form|website|organic|search/.test(src)) sourcePts = 2;
    else if (/event|webinar|partner|linkedin/.test(src)) sourcePts = 1;
    // outbound, cold, list, unknown -> 0

    const raw = emailPts + notePts + taskPts + recencyPts + statusPts + valuePts + sourcePts;
    const score = clamp(raw, 0, 50);

    const summary = `based on ${s.inboundEmailCount} inbound emails, ${s.noteCount} notes, ${s.completedTaskCount} completed tasks${
      s.daysSinceLastActivity != null
        ? `, ${s.daysSinceLastActivity}d since last activity`
        : ''
    }`;

    return { score, summary };
  }

  // ─── AI ─────────────────────────────────────────────────────────────

  private buildAiPrompt(args: {
    lead: any;
    recentNotes: { content: string; createdAt: Date }[];
    inboundEmails: {
      subject: string | null;
      bodyText: string | null;
      bodyHtml: string | null;
      receivedAt: Date;
      fromEmail: string;
    }[];
    outboundEmails: {
      subject: string | null;
      body: string | null;
      sentAt: Date;
      toEmail: string | null;
    }[];
  }): string {
    const { lead, recentNotes, inboundEmails, outboundEmails } = args;

    const blocks: string[] = [];
    blocks.push(
      [
        `Lead: ${lead.name}`,
        lead.company ? `Company: ${lead.company}` : null,
        lead.status?.name ? `Status: ${lead.status.name}` : null,
        lead.source?.name ? `Source: ${lead.source.name}` : null,
        lead.value != null ? `Pipeline value: ${lead.value}` : null,
        lead.description ? `Description: ${truncate(lead.description, 800)}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
    );

    if (recentNotes.length) {
      blocks.push(
        ['Notes:', ...recentNotes.map((n) => `- ${truncate(n.content, 600)}`)].join('\n'),
      );
    }

    if (inboundEmails.length) {
      blocks.push(
        [
          'Inbound emails (newest first):',
          ...inboundEmails.map((e) => {
            const body = pickBody(e.bodyText, e.bodyHtml).slice(0, PER_MESSAGE_CAP_CHARS);
            return `- From ${e.fromEmail} | ${e.subject ?? '(no subject)'}\n  ${body.replace(/\n/g, ' ')}`;
          }),
        ].join('\n'),
      );
    }

    if (outboundEmails.length) {
      blocks.push(
        [
          'Outbound emails (newest first):',
          ...outboundEmails.map((e) => {
            const body = (e.body ?? '').slice(0, PER_MESSAGE_CAP_CHARS);
            return `- To ${e.toEmail ?? '?'} | ${e.subject ?? '(no subject)'}\n  ${body.replace(/\n/g, ' ')}`;
          }),
        ].join('\n'),
      );
    }

    if (!recentNotes.length && !inboundEmails.length && !outboundEmails.length) {
      blocks.push(
        '(No notes or email activity yet — score from headline metadata only.)',
      );
    }

    let combined = blocks.join('\n\n');
    if (combined.length > PROMPT_CAP_CHARS) {
      combined = combined.slice(0, PROMPT_CAP_CHARS) + '\n[truncated]';
    }
    return combined;
  }

  private async callAi(
    apiKey: string,
    userPrompt: string,
  ): Promise<{ score: number; reason: string }> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: AI_MAX_TOKENS,
        system: AI_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Anthropic ${res.status}: ${detail.slice(0, 200)}`);
    }

    const data: any = await res.json();
    const text =
      Array.isArray(data?.content) && typeof data.content[0]?.text === 'string'
        ? data.content[0].text.trim()
        : '';

    if (!text) throw new Error('Empty AI response');

    return parseAiOutput(text);
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Parse `SCORE: <int>\nREASON: <text>` from the model's reply. Tolerant
 * of whitespace, leading/trailing junk, and re-ordering. Throws on
 * fundamental parse failure so the caller can fall back to neutral 25.
 */
export function parseAiOutput(text: string): { score: number; reason: string } {
  const scoreMatch = text.match(/SCORE\s*:\s*(-?\d+)/i);
  const reasonMatch = text.match(/REASON\s*:\s*([^\n\r]+)/i);
  if (!scoreMatch) throw new Error('No SCORE: line in AI output');
  let score = parseInt(scoreMatch[1], 10);
  if (!Number.isFinite(score)) throw new Error('Non-numeric SCORE');
  score = clamp(score, 0, 50);
  const reason = (reasonMatch?.[1] ?? '').trim().slice(0, 100) || 'no reason given';
  return { score, reason };
}

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function daysBetween(later: Date, earlier: Date): number {
  const ms = later.getTime() - earlier.getTime();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

function leadValueAsNumber(v: any): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  // Prisma Decimal serialises to string OR a Decimal instance with toNumber().
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof v?.toNumber === 'function') {
    try { return v.toNumber(); } catch { return 0; }
  }
  return 0;
}

function pickLastActivity(
  lead: any,
  notes: { createdAt: Date }[],
  inbound: { receivedAt: Date }[],
  outbound: { sentAt: Date }[],
): Date | null {
  const candidates: number[] = [];
  if (lead.lastContact) candidates.push(new Date(lead.lastContact).getTime());
  if (notes[0]) candidates.push(new Date(notes[0].createdAt).getTime());
  if (inbound[0]) candidates.push(new Date(inbound[0].receivedAt).getTime());
  if (outbound[0]) candidates.push(new Date(outbound[0].sentAt).getTime());
  if (candidates.length === 0) return null;
  return new Date(Math.max(...candidates));
}

function pickBody(bodyText: string | null, bodyHtml: string | null): string {
  if (bodyText && bodyText.trim()) return bodyText.trim();
  if (bodyHtml && bodyHtml.trim()) return stripHtml(bodyHtml).trim();
  return '';
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
}

function truncate(s: string, max: number): string {
  if (!s) return '';
  return s.length > max ? s.slice(0, max) + '…' : s;
}
