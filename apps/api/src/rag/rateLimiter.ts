/**
 * Proactive embedding rate-limiter (band-aid for the Google free-tier caps, ISSUE-097
 * follow-up). The retry-on-429 in [embedding.ts](./embedding.ts) only reacts *after* a
 * rejection; this limiter blocks *before* the call so we stay under the per-minute /
 * per-day quota instead of storming it. A single process-wide singleton
 * ([getEmbedRateLimiter]) tracks usage across every embedder (query + ingest + agent),
 * because the chat route builds a fresh embedder per request.
 *
 * The real fix is Phase C (local embedding on the RX570 → no quota at all); this only
 * has to keep the cloud path honest until then.
 */

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** Per-model quota caps (requests/min, tokens/min, requests/day). */
export type RateLimits = { rpm: number; tpm: number; rpd: number };

/** Injectable clock/sleep so tests can drive virtual time instead of real timers. */
export type LimiterDeps = { now?: () => number; sleep?: (ms: number) => Promise<void> };

/** Thrown by `acquire` when a slot won't free up within `maxWaitMs`. */
export class QuotaExhaustedError extends Error {
  constructor(model: string) {
    super(`Embedding quota exhausted for ${model} (rate-limited; try again later)`);
    this.name = "QuotaExhaustedError";
  }
}

/**
 * Rough token count for quota accounting. Latin text is ~4 chars/token, but Gemini
 * splits accented/CJK code points into more sub-tokens, so we count every non-ASCII
 * char as a whole token — deliberately conservative so a Vietnamese query never
 * *under*-estimates and slips past the limiter into a real 429.
 */
export function estimateTokens(text: string): number {
  let ascii = 0;
  let nonAscii = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) < 128) {
      ascii += 1;
    } else {
      nonAscii += 1;
    }
  }
  return Math.max(1, Math.ceil(ascii / 4) + nonAscii);
}

type Entry = { t: number; tokens: number };

export class EmbedRateLimiter {
  private readonly buckets = new Map<string, Entry[]>();
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly limits: RateLimits, deps: LimiterDeps = {}) {
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /**
   * Block until sending `estTokens` more tokens for `model` fits under all three caps,
   * then record the usage. Waits at most `maxWaitMs` (measured on the injected clock)
   * before throwing `QuotaExhaustedError` — callers pick the budget: a chat query uses a
   * short wait (degrade to no-docs fast), an offline ingest a long one (patient throttle).
   */
  async acquire(model: string, estTokens: number, maxWaitMs: number): Promise<void> {
    const deadline = this.now() + maxWaitMs;
    for (;;) {
      const now = this.now();
      const entries = this.prune(model, now);
      const minAgo = now - MINUTE_MS;
      const dayAgo = now - DAY_MS;
      let reqMin = 0;
      let tokMin = 0;
      let reqDay = 0;
      let oldestMin = Infinity;
      let oldestDay = Infinity;
      for (const entry of entries) {
        if (entry.t > minAgo) {
          reqMin += 1;
          tokMin += entry.tokens;
          if (entry.t < oldestMin) {
            oldestMin = entry.t;
          }
        }
        if (entry.t > dayAgo) {
          reqDay += 1;
          if (entry.t < oldestDay) {
            oldestDay = entry.t;
          }
        }
      }

      const okRpm = reqMin + 1 <= this.limits.rpm;
      const okTpm = tokMin + estTokens <= this.limits.tpm;
      const okRpd = reqDay + 1 <= this.limits.rpd;
      if (okRpm && okTpm && okRpd) {
        entries.push({ t: now, tokens: estTokens });
        return;
      }

      // Wait until the earliest in-window entry ages out, then re-check. If nothing can
      // age out (empty window but still over a cap ⇒ the single request exceeds a limit),
      // there is no point waiting.
      let wait = Infinity;
      if ((!okRpm || !okTpm) && oldestMin !== Infinity) {
        wait = Math.min(wait, oldestMin + MINUTE_MS - now);
      }
      if (!okRpd && oldestDay !== Infinity) {
        wait = Math.min(wait, oldestDay + DAY_MS - now);
      }
      if (!Number.isFinite(wait)) {
        throw new QuotaExhaustedError(model);
      }
      const clamped = Math.max(wait, 1);
      if (now + clamped > deadline) {
        throw new QuotaExhaustedError(model);
      }
      await this.sleep(clamped);
    }
  }

  /** Drop entries older than a day and return the (mutated) live array for `model`. */
  private prune(model: string, now: number): Entry[] {
    const dayAgo = now - DAY_MS;
    const kept = (this.buckets.get(model) ?? []).filter((entry) => entry.t > dayAgo);
    this.buckets.set(model, kept);
    return kept;
  }
}

let shared: EmbedRateLimiter | null = null;

/** Process-wide singleton so every embedder shares one quota view. */
export function getEmbedRateLimiter(limits: RateLimits): EmbedRateLimiter {
  if (!shared) {
    shared = new EmbedRateLimiter(limits);
  }
  return shared;
}

/** Test hook: forget the singleton so a fresh limits/clock can be installed. */
export function resetEmbedRateLimiter(): void {
  shared = null;
}
