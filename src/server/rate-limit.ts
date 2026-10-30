/**
 * Dependency-free sliding-window rate limiter.
 *
 * Each model call costs money and latency, and the service is deliberately open
 * so evaluators can try it, so an unauthenticated endpoint needs a ceiling.
 * Time-injectable, so it is unit-testable without fake timers.
 *
 * State is in-process. Under horizontal autoscaling each instance keeps its own
 * window, so the effective global limit is `max × instances`; a distributed
 * deployment would back this with Redis. Documented in ARCHITECTURE.md.
 */

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  /** Cap on distinct keys retained, to bound memory under key-space attacks. */
  maxKeys?: number;
}

interface RateLimitResult {
  allowed: boolean;
  /** Hits remaining in the current window after this check. */
  remaining: number;
  /** Milliseconds until a slot frees up (0 when allowed). */
  retryAfterMs: number;
}

export interface RateLimiter {
  check(key: string, now?: number): RateLimitResult;
  size(): number;
}

const DEFAULT_MAX_KEYS = 10_000;

export function createRateLimiter({
  windowMs,
  max,
  maxKeys = DEFAULT_MAX_KEYS,
}: RateLimitOptions): RateLimiter {
  const hits = new Map<string, number[]>();

  function evictExpired(now: number): void {
    for (const [key, times] of hits) {
      const newest = times[times.length - 1];
      if (newest === undefined || now - newest >= windowMs) hits.delete(key);
    }
  }

  return {
    check(key, now = Date.now()) {
      const recent = (hits.get(key) ?? []).filter((time) => now - time < windowMs);

      if (recent.length >= max) {
        hits.set(key, recent);
        const oldest = recent[0] ?? now;
        return {
          allowed: false,
          remaining: 0,
          retryAfterMs: Math.max(0, windowMs - (now - oldest)),
        };
      }

      if (!hits.has(key) && hits.size >= maxKeys) {
        evictExpired(now);
        if (hits.size >= maxKeys) {
          // Still full of live keys: fail closed for new keys rather than let
          // memory grow without limit.
          return { allowed: false, remaining: 0, retryAfterMs: windowMs };
        }
      }

      recent.push(now);
      hits.set(key, recent);
      return { allowed: true, remaining: max - recent.length, retryAfterMs: 0 };
    },
    size() {
      return hits.size;
    },
  };
}
