/**
 * Provider-agnostic AI completion contract.
 *
 * Both AnthropicProvider and OpenAiProvider implement this so the three AI
 * consumers (ai-improve, inbox-ai, lead-scoring) don't care which upstream
 * they're talking to — they just call `complete()` and read `.text`.
 *
 * Deliberately a single non-streaming text-in / text-out call: it's the
 * lowest common denominator across the Anthropic Messages API and the
 * OpenAI Chat Completions API, and it's all the existing call sites need.
 */

export interface AiCompleteOptions {
  /** System / instruction prompt. */
  system: string;
  /** The single user-turn message. */
  userMessage: string;
  /** Hard cap on generated tokens. */
  maxTokens: number;
  /** Provider-specific model id, e.g. `claude-haiku-4-5-20251001` / `gpt-4o-mini`. */
  model: string;
}

export interface AiCompleteResult {
  /** The generated text, trimmed. */
  text: string;
  /** Prompt tokens consumed, when the upstream reports them. */
  inputTokens?: number;
  /** Completion tokens consumed, when the upstream reports them. */
  outputTokens?: number;
}

export interface AiProvider {
  complete(opts: AiCompleteOptions): Promise<AiCompleteResult>;
}

/**
 * Thrown on a non-2xx upstream response (or transport failure). Carries the
 * upstream HTTP status + a (truncated) upstream message so callers can decide
 * whether to surface a graceful 503 / 500 or fall back to a heuristic.
 */
export class AiProviderError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly provider?: string,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

/** Best-effort body read that never throws. */
export async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
