/**
 * Token-meter color scale for the composer's SVG progress ring (ISSUE-079).
 * 10 discrete levels from cool cyan (low context usage) → blue → amber → coral red
 * (near the model's context window). The denominator is the *real* context window
 * (`AiUsage.contextSize`, only reported by the local llama backend); other backends
 * have no window number, so the caller shows a neutral indicator instead of a ring.
 */
export const TOKEN_RING_COLORS = [
  "#22d3ee", // 0 — cyan
  "#38bdf8",
  "#0ea5e9",
  "#3b82f6",
  "#6366f1",
  "#f59e0b", // 5 — amber
  "#fb923c",
  "#f97316",
  "#ef4444",
  "#dc2626" // 9 — coral red
] as const;

/** Map a usage ratio (used/window) in [0,1] to a color level 0..9. */
export function levelForRatio(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return 0;
  }
  if (ratio >= 1) {
    return TOKEN_RING_COLORS.length - 1;
  }
  return Math.min(TOKEN_RING_COLORS.length - 1, Math.floor(ratio * TOKEN_RING_COLORS.length));
}

/** Ring stroke color for a given usage ratio. */
export function tokenRingColor(ratio: number): string {
  return TOKEN_RING_COLORS[levelForRatio(ratio)] ?? TOKEN_RING_COLORS[0];
}
