import { describe, expect, it } from "vitest";
import { TOKEN_RING_COLORS, levelForRatio, tokenRingColor } from "./aiTokens.js";

describe("levelForRatio", () => {
  it("returns 0 for non-positive or invalid ratios", () => {
    expect(levelForRatio(0)).toBe(0);
    expect(levelForRatio(-1)).toBe(0);
    expect(levelForRatio(Number.NaN)).toBe(0);
  });

  it("clamps to the top level at or above full", () => {
    expect(levelForRatio(1)).toBe(9);
    expect(levelForRatio(1.5)).toBe(9);
  });

  it("buckets the mid range into 10 levels", () => {
    expect(levelForRatio(0.05)).toBe(0);
    expect(levelForRatio(0.15)).toBe(1);
    expect(levelForRatio(0.55)).toBe(5);
    expect(levelForRatio(0.95)).toBe(9);
  });

  it("maps each end of the scale to a color", () => {
    expect(tokenRingColor(0)).toBe(TOKEN_RING_COLORS[0]);
    expect(tokenRingColor(1)).toBe(TOKEN_RING_COLORS[9]);
  });
});
