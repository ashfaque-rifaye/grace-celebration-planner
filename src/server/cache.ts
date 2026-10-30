/**
 * Tiny LRU + TTL cache so identical model calls are only paid for once.
 *
 * Deliberately in-process and bounded: it is a cost and latency optimisation, not
 * a source of truth, so eviction can only ever cause a cache miss. Time-injectable
 * so expiry is testable without fake timers.
 */

export interface LruCache<T> {
  get(key: string, now?: number): T | undefined;
  set(key: string, value: T, now?: number): void;
  size(): number;
}

export function createLruCache<T>(options: { maxEntries: number; ttlMs: number }): LruCache<T> {
  // Map preserves insertion order, so re-inserting on read gives LRU semantics
  // without a linked list.
  const entries = new Map<string, { value: T; expiresAt: number }>();

  return {
    get(key, now = Date.now()) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      entries.delete(key);
      if (now >= entry.expiresAt) return undefined;
      entries.set(key, entry);
      return entry.value;
    },
    set(key, value, now = Date.now()) {
      entries.delete(key);
      entries.set(key, { value, expiresAt: now + options.ttlMs });
      while (entries.size > options.maxEntries) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
      }
    },
    size() {
      return entries.size;
    },
  };
}
