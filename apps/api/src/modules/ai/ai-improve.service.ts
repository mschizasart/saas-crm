import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  BadRequestException,
  HttpException,
} from '@nestjs/common';
import { enforceAiRateLimit } from './rate-limit.util';
import { AiConfigService } from './ai-config.service';

/**
 * Stateless AI text-tone enhancement service.
 *
 * - Transport is resolved per-org via AiConfigService.resolveProvider():
 *   the tenant's own Anthropic/OpenAI key when configured, otherwise the
 *   platform's shared ANTHROPIC_API_KEY. We don't depend on any SDK.
 * - No DB writes — generated text is returned to the caller and forgotten
 *   (token usage is metered fire-and-forget via AiConfigService.recordUsage).
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

const MAX_TOKENS = 1500;
const SYSTEM_PROMPT_TEMPLATE =
  "Rewrite the user's text in a {tone} tone. Preserve meaning, structure, lists, and any signoffs. Return only the rewritten text — no preamble, no quotes, no explanations.";

// Hard caps to keep costs bounded per request.
const MIN_INPUT_LEN = 1;
const MAX_INPUT_LEN = 12_000;

@Injectable()
export class AiImproveService {
  private readonly logger = new Logger(AiImproveService.name);

  constructor(private readonly aiConfig: AiConfigService) {}

  /**
   * Rewrite `text` in the given `tone`. Throws:
   *   - 400 BadRequestException for empty/oversize input or bad tone
   *   - 429 TooManyRequestsException when the user exceeds the rate limit
   *   - 503 ServiceUnavailableException when AI is not configured / disabled /
   *     over the org's monthly cap, or when the upstream call fails (we
   *     deliberately do NOT bubble the provider's raw error text to clients).
   */
  async improve(args: {
    userId: string;
    orgId: string;
    text: string;
    tone: ImproveTone;
    maxLength?: number;
  }): Promise<{ improved: string }> {
    const { userId, orgId, text, tone, maxLength } = args;

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

    enforceAiRateLimit(userId);

    // Resolve the per-org provider. resolveProvider() throws clean 503s for
    // the not-configured / disabled / over-cap cases — let those bubble.
    const { provider, model } = await this.aiConfig.resolveProvider(orgId);

    const lengthHint =
      typeof maxLength === 'number' && maxLength > 0
        ? ` Keep the result under approximately ${Math.min(maxLength, 5000)} characters.`
        : '';

    const system = SYSTEM_PROMPT_TEMPLATE.replace('{tone}', tone) + lengthHint;

    try {
      const { text: improved, inputTokens, outputTokens } =
        await provider.complete({
          system,
          userMessage: trimmed,
          maxTokens: MAX_TOKENS,
          model,
        });

      if (!improved) {
        this.logger.warn('AI provider returned empty content');
        throw new ServiceUnavailableException(
          'AI service is temporarily unavailable',
        );
      }

      // Fire-and-forget — never block the response on the usage write.
      void this.aiConfig.recordUsage(orgId, inputTokens, outputTokens);

      return { improved: improved.trim() };
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
}
