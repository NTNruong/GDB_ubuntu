import { describe, expect, it } from "vitest";
import { parseBreakpointText, toggleBreakpointText } from "./breakpoints";

describe("breakpoint parsing", () => {
  it("returns no breakpoints for empty input", () => {
    expect(parseBreakpointText("")).toEqual([]);
  });

  it("ignores placeholder-like text", () => {
    expect(parseBreakpointText("e.g. 6, 12")).toEqual([]);
  });

  it("parses positive line numbers", () => {
    expect(parseBreakpointText("6, 12 6 nope -1 0")).toEqual([6, 12]);
  });

  it("toggles line numbers", () => {
    expect(toggleBreakpointText("", 6)).toBe("6");
    expect(toggleBreakpointText("6, 12", 6)).toBe("12");
  });
});
