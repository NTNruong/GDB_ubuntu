import { describe, expect, it } from "vitest";
import { parseInfoLocals } from "./dapDebugSession.js";

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
