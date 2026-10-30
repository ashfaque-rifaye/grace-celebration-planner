import { describe, expect, it } from "vitest";
import { createLruCache } from "./cache";

describe("createLruCache", () => {
  it("returns what was stored", () => {
    const cache = createLruCache<string>({ maxEntries: 2, ttlMs: 100 });
    cache.set("a", "1", 0);
    expect(cache.get("a", 50)).toBe("1");
    expect(cache.get("missing", 50)).toBeUndefined();
  });

  it("expires exactly at the TTL", () => {
    const cache = createLruCache<string>({ maxEntries: 2, ttlMs: 100 });
    cache.set("a", "1", 0);
    expect(cache.get("a", 99)).toBe("1");
    expect(cache.get("a", 100)).toBeUndefined();
    expect(cache.size()).toBe(0);
  });

  it("evicts the least recently used entry", () => {
    const cache = createLruCache<string>({ maxEntries: 2, ttlMs: 100 });
    cache.set("a", "1", 0);
    cache.set("b", "2", 0);
    cache.get("a", 1);
    cache.set("c", "3", 2);
    expect(cache.get("b", 3)).toBeUndefined();
    expect(cache.get("a", 3)).toBe("1");
    expect(cache.get("c", 3)).toBe("3");
  });

  it("does not double-count an overwrite", () => {
    const cache = createLruCache<string>({ maxEntries: 2, ttlMs: 100 });
    cache.set("a", "1", 0);
    cache.set("a", "2", 0);
    cache.set("b", "3", 0);
    expect(cache.size()).toBe(2);
    expect(cache.get("a", 1)).toBe("2");
  });

  it("uses the real clock by default", () => {
    const cache = createLruCache<string>({ maxEntries: 1, ttlMs: 60_000 });
    cache.set("a", "1");
    expect(cache.get("a")).toBe("1");
  });
});
