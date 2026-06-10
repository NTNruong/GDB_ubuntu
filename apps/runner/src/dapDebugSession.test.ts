import { describe, expect, it } from "vitest";
import {
  boundSummary,
  frameMatchesBreakpoint,
  normalizeChildNames,
  parseInfoLocals,
  summarizeChildren
} from "./dapDebugSession.js";

describe("parseInfoLocals", () => {
  it("parses simple name = value pairs", () => {
    const result = parseInfoLocals("n = 6\nresult = 36\n");
    expect(result).toEqual([
      { name: "n", value: "6" },
      { name: "result", value: "36" }
    ]);
  });

  it("returns empty list for 'No locals.'", () => {
    expect(parseInfoLocals("No locals.\n")).toEqual([]);
  });

  it("returns empty list for 'No arguments.'", () => {
    expect(parseInfoLocals("No arguments.\n")).toEqual([]);
  });

  it("returns empty list for empty input", () => {
    expect(parseInfoLocals("")).toEqual([]);
  });

  it("handles multi-line values (struct/aggregate)", () => {
    const result = parseInfoLocals("p = {\n  x = 1,\n  y = 2\n}\nq = 7\n");
    expect(result).toEqual([
      { name: "p", value: "{\nx = 1,\ny = 2\n}" },
      { name: "q", value: "7" }
    ]);
  });

  it("handles pointer values with addresses", () => {
    const result = parseInfoLocals('s = 0x7fff1234 "hello"\nn = 42\n');
    expect(result).toEqual([
      { name: "s", value: '0x7fff1234 "hello"' },
      { name: "n", value: "42" }
    ]);
  });

  it("ignores blank lines and trailing whitespace", () => {
    const result = parseInfoLocals("\n  n = 6   \n\nresult = 36\n\n");
    expect(result).toEqual([
      { name: "n", value: "6" },
      { name: "result", value: "36" }
    ]);
  });
});

describe("summarizeChildren", () => {
  it("renders array children as a brace-wrapped value list", () => {
    const result = summarizeChildren(
      [
        { name: "[0]", value: "1" },
        { name: "[1]", value: "3" },
        { name: "[2]", value: "5" }
      ],
      false
    );
    expect(result).toBe("{1, 3, 5}");
  });

  it("renders struct children as name = value pairs", () => {
    const result = summarizeChildren(
      [
        { name: "x", value: "1" },
        { name: "y", value: "2" }
      ],
      false
    );
    expect(result).toBe("{x = 1, y = 2}");
  });

  it("appends an ellipsis item when more children exist", () => {
    const result = summarizeChildren([{ name: "[0]", value: "1" }], true);
    expect(result).toBe("{1, …}");
  });

  it("returns empty braces for no children", () => {
    expect(summarizeChildren([], false)).toBe("{}");
  });
});

describe("normalizeChildNames", () => {
  it("rewrites all-numeric child names to bracketed array indices", () => {
    const result = normalizeChildNames([
      { name: "0", value: "1" },
      { name: "1", value: "3" },
      { name: "2", value: "5" }
    ]);
    expect(result.map((c) => c.name)).toEqual(["[0]", "[1]", "[2]"]);
  });

  it("leaves named (struct) children untouched", () => {
    const children = [
      { name: "x", value: "1" },
      { name: "y", value: "2" }
    ];
    expect(normalizeChildNames(children)).toEqual(children);
  });

  it("leaves mixed children untouched", () => {
    const children = [
      { name: "0", value: "1" },
      { name: "len", value: "5" }
    ];
    expect(normalizeChildNames(children)).toEqual(children);
  });

  it("returns empty input unchanged", () => {
    expect(normalizeChildNames([])).toEqual([]);
  });
});

describe("frameMatchesBreakpoint", () => {
  const breakpoints = [
    { path: "main.c", line: 6 },
    { path: "util.c", line: 3 }
  ];

  it("matches an absolute /workspace path by basename + line", () => {
    expect(frameMatchesBreakpoint({ source: { path: "/workspace/main.c" }, line: 6 }, breakpoints)).toBe(true);
    expect(frameMatchesBreakpoint({ source: { path: "/workspace/util.c" }, line: 3 }, breakpoints)).toBe(true);
  });

  it("does not match the entry stop (different line / file)", () => {
    // main()'s opening line, not a user breakpoint → treated as the entry stop.
    expect(frameMatchesBreakpoint({ source: { path: "/workspace/main.c" }, line: 3 }, breakpoints)).toBe(false);
    expect(frameMatchesBreakpoint({ source: { path: "/workspace/other.c" }, line: 6 }, breakpoints)).toBe(false);
  });

  it("falls back to source.name when path is absent", () => {
    expect(frameMatchesBreakpoint({ source: { name: "util.c" }, line: 3 }, breakpoints)).toBe(true);
  });

  it("returns false for missing frame or missing line", () => {
    expect(frameMatchesBreakpoint(undefined, breakpoints)).toBe(false);
    expect(frameMatchesBreakpoint({ source: { path: "/workspace/main.c" } }, breakpoints)).toBe(false);
  });

  it("returns false when there are no breakpoints", () => {
    expect(frameMatchesBreakpoint({ source: { path: "/workspace/main.c" }, line: 6 }, [])).toBe(false);
  });
});

describe("boundSummary", () => {
  it("returns short values unchanged", () => {
    expect(boundSummary("{1, 2, 3}")).toBe("{1, 2, 3}");
  });

  it("truncates over-long values to the char cap with an ellipsis", () => {
    const result = boundSummary("x".repeat(250));
    expect(result.length).toBe(200);
    expect(result.endsWith("…")).toBe(true);
  });
});
