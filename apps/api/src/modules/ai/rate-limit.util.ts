import { TooManyRequestsException } from '@nestjs/common';

/**
 * Lightweight per-user token-bucket rate limiter for AI calls.
 *
 * Extracted from `ai-improve.service.ts` so every AI endpoint shares a single
 * pool — a tenant who burns their budget on tone rewrites can't then turn
 * around and spam the inbox-summarizer.
 *
 * In a multi-node deploy this remains per-node (acceptable for v1, same
 * trade-off as the original implementation).
 */

const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;
const userHits = new Map<string, number[]>();

export const AI_RATE_LIMIT = RATE_LIMIT;
export const AI_RATE_WINDOW_MS = RATE_WINDOW_MS;

export function enforceAiRateLimit(userId: string): void {
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

/** Test-only: clear the in-memory bucket. */
export function __resetAiRateLimitForTests(): void {
  userHits.clear();
}
