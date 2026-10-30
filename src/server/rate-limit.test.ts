import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rate-limit";

describe("createRateLimiter", () => {
  const options = { windowMs: 1000, max: 2 };

  it("allows up to the limit and reports what remains", () => {
    const limiter = createRateLimiter(options);
    expect(limiter.check("a", 0)).toEqual({ allowed: true, remaining: 1, retryAfterMs: 0 });
    expect(limiter.check("a", 1).remaining).toBe(0);
  });

  it("blocks over the limit and says when to retry", () => {
    const limiter = createRateLimiter(options);
    limiter.check("a", 0);
    limiter.check("a", 100);
    expect(limiter.check("a", 200)).toEqual({ allowed: false, remaining: 0, retryAfterMs: 800 });
  });

  it("frees a slot exactly when the oldest hit leaves the window", () => {
    const limiter = createRateLimiter(options);
    limiter.check("a", 0);
    limiter.check("a", 100);
    expect(limiter.check("a", 999).allowed).toBe(false);
    expect(limiter.check("a", 1000).allowed).toBe(true);
  });

  it("isolates keys from each other", () => {
    const limiter = createRateLimiter({ windowMs: 1000, max: 1 });
    expect(limiter.check("a", 0).allowed).toBe(true);
    expect(limiter.check("b", 0).allowed).toBe(true);
    expect(limiter.check("a", 0).allowed).toBe(false);
  });

  it("evicts expired keys when the key space fills", () => {
    const limiter = createRateLimiter({ windowMs: 1000, max: 1, maxKeys: 2 });
    limiter.check("a", 0);
    limiter.check("b", 0);
    expect(limiter.check("c", 2000).allowed).toBe(true);
    expect(limiter.size()).toBe(1);
  });

  it("fails closed for new keys under a key-flooding attack", () => {
    const limiter = createRateLimiter({ windowMs: 1000, max: 1, maxKeys: 2 });
    limiter.check("a", 0);
    limiter.check("b", 0);
    expect(limiter.check("c", 1)).toEqual({ allowed: false, remaining: 0, retryAfterMs: 1000 });
    expect(limiter.size()).toBe(2);
  });

  it("uses the real clock by default", () => {
    const limiter = createRateLimiter(options);
    expect(limiter.check("a").allowed).toBe(true);
  });
});
