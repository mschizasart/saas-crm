import {
  AiCompleteOptions,
  AiCompleteResult,
  AiProvider,
  AiProviderError,
  safeReadText,
} from './ai-provider.types';

/**
 * OpenAI Chat Completions API provider — raw `fetch`, no SDK dependency.
 *
 * Normalises OpenAI's request/response shape onto the shared AiProvider
 * contract:
 *   - system prompt   → messages[0] with role 'system'
 *   - user message    → messages[1] with role 'user'
 *   - choices[0].message.content → result.text
 *   - usage.prompt_tokens / usage.completion_tokens → input/outputTokens
 */
export class OpenAiProvider implements AiProvider {
  static readonly DEFAULT_MODEL = 'gpt-4o-mini';
  private static readonly ENDPOINT =
    'https://api.openai.com/v1/chat/completions';

  constructor(private readonly apiKey: string) {}

  async complete(opts: AiCompleteOptions): Promise<AiCompleteResult> {
    let res: Response;
    try {
      res = await fetch(OpenAiProvider.ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: opts.model,
          max_tokens: opts.maxTokens,
          messages: [
            { role: 'system', content: opts.system },
            { role: 'user', content: opts.userMessage },
          ],
        }),
      });
    } catch (err) {
      throw new AiProviderError(
        `OpenAI request failed: ${(err as Error).message ?? err}`,
        undefined,
        'OPENAI',
      );
    }

    if (!res.ok) {
      const detail = await safeReadText(res);
      throw new AiProviderError(
        `OpenAI ${res.status}: ${detail.slice(0, 300)}`,
        res.status,
        'OPENAI',
      );
    }

    const data: any = await res.json();
    const text =
      Array.isArray(data?.choices) &&
      typeof data.choices[0]?.message?.content === 'string'
        ? data.choices[0].message.content.trim()
        : '';

    if (!text) {
      throw new AiProviderError(
        'OpenAI returned empty content',
        res.status,
        'OPENAI',
      );
    }

    return {
      text,
      inputTokens:
        typeof data?.usage?.prompt_tokens === 'number'
          ? data.usage.prompt_tokens
          : undefined,
      outputTokens:
        typeof data?.usage?.completion_tokens === 'number'
          ? data.usage.completion_tokens
          : undefined,
    };
  }
}
