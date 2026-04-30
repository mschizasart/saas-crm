import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  BadRequestException,
  HttpException,
  TooManyRequestsException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Stateless AI text-tone enhancement service.
 *
 * - Calls the Anthropic Messages API directly via fetch (Claude is the
 *   product's chosen model; we don't depend on the OpenAI SDK).
 * - No DB writes — generated text is returned to the caller and forgotten.
 * - Cost-control: small in-memory token-bucket per user (30 req / 60s).
 *   In a multi-node deploy this becomes per-node — acceptable for v1.
 */

export type ImproveTone =
  | 'friendly'
  | 'professional'
  | 'concise'
  | 'persuasive'
  | 'expand'
  | 'shorten';

export const IMPROVE_TONES: ImproveTone[] = [
  'friendly',
  'professional',
  'concise',
  'persuasive',
  'expand',
  'shorten',
];

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 1500;
const SYSTEM_PROMPT_TEMPLATE =
  "Rewrite the user's text in a {tone} tone. Preserve meaning, structure, lists, and any signoffs. Return only the rewritten text — no preamble, no quotes, no explanations.";

// Hard caps to keep costs bounded per request.
const MIN_INPUT_LEN = 1;
const MAX_INPUT_LEN = 12_000;

// Rate limit: 30 calls per user per rolling 60s window.
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;
const userHits = new Map<string, number[]>();

@Injectable()
export class AiImproveService {
  private readonly logger = new Logger(AiImproveService.name);

  constructor(private config: ConfigService) {}

  /**
   * Rewrite `text` in the given `tone`. Throws:
   *   - 400 BadRequestException for empty/oversize input or bad tone
   *   - 429 TooManyRequestsException when the user exceeds the rate limit
   *   - 503 ServiceUnavailableException when ANTHROPIC_API_KEY is not set
   *     or the upstream call fails (we deliberately do NOT bubble Anthropic's
   *     raw error text to clients).
   */
  async improve(args: {
    userId: string;
    text: string;
    tone: ImproveTone;
    maxLength?: number;
  }): Promise<{ improved: string }> {
    const { userId, text, tone, maxLength } = args;

    if (!IMPROVE_TONES.includes(tone)) {
      throw new BadRequestException(`Invalid tone "${tone}"`);
    }
    const trimmed = (text ?? '').trim();
    if (trimmed.length < MIN_INPUT_LEN) {
      throw new BadRequestException('Text is empty');
    }
    if (trimmed.length > MAX_INPUT_LEN) {
      throw new BadRequestException(
        `Text is too long (max ${MAX_INPUT_LEN} characters)`,
      );
    }

    this.checkRateLimit(userId);

    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'AI features are not configured by your administrator',
      );
    }

    const lengthHint =
      typeof maxLength === 'number' && maxLength > 0
        ? ` Keep the result under approximately ${Math.min(maxLength, 5000)} characters.`
        : '';

    const system = SYSTEM_PROMPT_TEMPLATE.replace('{tone}', tone) + lengthHint;

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system,
          messages: [{ role: 'user', content: trimmed }],
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
      const improved =
        Array.isArray(data?.content) && typeof data.content[0]?.text === 'string'
          ? data.content[0].text.trim()
          : '';

      if (!improved) {
        this.logger.warn('Anthropic returned empty content');
        throw new ServiceUnavailableException(
          'AI service is temporarily unavailable',
        );
      }

      return { improved };
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.error(
        `AI improve-text failed: ${(err as Error).message ?? err}`,
      );
      throw new ServiceUnavailableException(
        'AI service is temporarily unavailable',
      );
    }
  }

  private checkRateLimit(userId: string) {
    const now = Date.now();
    const arr = userHits.get(userId) ?? [];
    const fresh = arr.filter((t) => now - t < RATE_WINDOW_MS);
    if (fresh.length >= RATE_LIMIT) {
      throw new TooManyRequestsException(
        'Too many AI requests. Please wait a minute and try again.',
      );
    }
    fresh.push(now);
    userHits.set(userId, fresh);
    // Cheap GC so the map doesn't grow unbounded across long-lived processes.
    if (userHits.size > 5_000) {
      for (const [uid, hits] of userHits) {
        const keep = hits.filter((t) => now - t < RATE_WINDOW_MS);
        if (keep.length === 0) userHits.delete(uid);
        else userHits.set(uid, keep);
      }
    }
  }
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
