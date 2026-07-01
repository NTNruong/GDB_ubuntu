import { describe, expect, it } from "vitest";
import { EmbedRateLimiter, QuotaExhaustedError, estimateTokens } from "./rateLimiter.js";

/** Virtual clock so 60s windows are testable without real timers. */
function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: (ms: number) => {
      t += ms;
      return Promise.resolve();
    },
    advance: (ms: number) => {
      t += ms;
    }
  };
}

describe("estimateTokens", () => {
  it("counts ASCII at ~4 chars/token", () => {
    expect(estimateTokens("abcdefgh")).toBe(2);
  });

  it("counts every non-ASCII char as a whole token (conservative for Vietnamese)", () => {
    // "sửa" = s + ư + a → 2 ASCII (ceil(2/4)=1) + 1 non-ASCII = 2.
    expect(estimateTokens("sửa")).toBe(2);
  });

  it("never returns 0 for non-empty text", () => {
    expect(estimateTokens("a")).toBe(1);
  });
});

describe("EmbedRateLimiter", () => {
  it("admits requests under the caps", async () => {
    const clock = fakeClock();
    const limiter = new EmbedRateLimiter({ rpm: 5, tpm: 1000, rpd: 100 }, clock);
    await expect(limiter.acquire("m", 10, 1000)).resolves.toBeUndefined();
    await expect(limiter.acquire("m", 10, 1000)).resolves.toBeUndefined();
  });

  it("blocks on RPM then releases once the minute window ages out", async () => {
    const clock = fakeClock();
    const limiter = new EmbedRateLimiter({ rpm: 2, tpm: 1000, rpd: 100 }, clock);
    await limiter.acquire("m", 1, 1000);
    await limiter.acquire("m", 1, 1000);
    // Third would exceed rpm=2; with a generous budget it waits out the window.
    await expect(limiter.acquire("m", 1, 120_000)).resolves.toBeUndefined();
    expect(clock.now()).toBeGreaterThanOrEqual(60_000);
  });

  it("throws QuotaExhaustedError when the wait exceeds the budget", async () => {
    const clock = fakeClock();
    const limiter = new EmbedRateLimiter({ rpm: 1, tpm: 1000, rpd: 100 }, clock);
    await limiter.acquire("m", 1, 1000);
    await expect(limiter.acquire("m", 1, 1000)).rejects.toBeInstanceOf(QuotaExhaustedError);
  });

  it("enforces the per-minute token cap independently of request count", async () => {
    const clock = fakeClock();
    const limiter = new EmbedRateLimiter({ rpm: 100, tpm: 100, rpd: 100 }, clock);
    await limiter.acquire("m", 60, 1000);
    // 60 + 60 > 100 TPM → must wait; short budget → throw.
    await expect(limiter.acquire("m", 60, 1000)).rejects.toBeInstanceOf(QuotaExhaustedError);
  });

  it("tracks caps per model", async () => {
    const clock = fakeClock();
    const limiter = new EmbedRateLimiter({ rpm: 1, tpm: 1000, rpd: 100 }, clock);
    await limiter.acquire("a", 1, 1000);
    // A different model has its own bucket, so it is not blocked by "a".
    await expect(limiter.acquire("b", 1, 1000)).resolves.toBeUndefined();
  });
});
