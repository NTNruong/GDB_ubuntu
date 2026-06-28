import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, mergeSettings } from "./settings.js";

describe("mergeSettings", () => {
  it("returns defaults for non-object input", () => {
    expect(mergeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings("nope")).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps valid fields and falls back per-field for invalid ones", () => {
    expect(mergeSettings({ fontSize: 18, wordWrap: true, suggestions: false, theme: "light" })).toEqual({
      fontSize: 18,
      wordWrap: true,
      suggestions: false,
      theme: "light"
    });
    // Out-of-range font size and bad types fall back to defaults.
    expect(mergeSettings({ fontSize: 99, wordWrap: "yes", theme: "blue" })).toEqual(DEFAULT_SETTINGS);
  });

  it("rounds a fractional in-range font size", () => {
    expect(mergeSettings({ fontSize: 15.6 }).fontSize).toBe(16);
  });
});
