import {
  AiCompleteOptions,
  AiCompleteResult,
  AiProvider,
  AiProviderError,
  safeReadText,
} from './ai-provider.types';

/**
 * Anthropic Messages API provider — raw `fetch`, no SDK dependency
 * (matches the existing code style throughout the AI module).
 *
 * Used both for tenant-supplied Anthropic keys AND for the platform's
 * shared ANTHROPIC_API_KEY fallback (PLATFORM_DEFAULT).
 */
export class AnthropicProvider implements AiProvider {
  static readonly DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
  private static readonly ENDPOINT = 'https://api.anthropic.com/v1/messages';
  private static readonly API_VERSION = '2023-06-01';

  constructor(private readonly apiKey: string) {}

  async complete(opts: AiCompleteOptions): Promise<AiCompleteResult> {
    let res: Response;
    try {
      res = await fetch(AnthropicProvider.ENDPOINT, {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': AnthropicProvider.API_VERSION,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: opts.model,
          max_tokens: opts.maxTokens,
          system: opts.system,
          messages: [{ role: 'user', content: opts.userMessage }],
        }),
      });
    } catch (err) {
      throw new AiProviderError(
        `Anthropic request failed: ${(err as Error).message ?? err}`,
        undefined,
        'ANTHROPIC',
      );
    }

    if (!res.ok) {
      const detail = await safeReadText(res);
      throw new AiProviderError(
        `Anthropic ${res.status}: ${detail.slice(0, 300)}`,
        res.status,
        'ANTHROPIC',
      );
    }

    const data: any = await res.json();
    const text =
      Array.isArray(data?.content) && typeof data.content[0]?.text === 'string'
        ? data.content[0].text.trim()
        : '';

    if (!text) {
      throw new AiProviderError(
        'Anthropic returned empty content',
        res.status,
        'ANTHROPIC',
      );
    }

    return {
      text,
      inputTokens:
        typeof data?.usage?.input_tokens === 'number'
          ? data.usage.input_tokens
          : undefined,
      outputTokens:
        typeof data?.usage?.output_tokens === 'number'
          ? data.usage.output_tokens
          : undefined,
    };
  }
}
