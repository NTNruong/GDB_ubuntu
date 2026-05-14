import { describe, expect, it } from "vitest";
import {
  DebugRequestSchema,
  LANGUAGE_CAPABILITIES,
  RunRequestSchema,
  parseArgv
} from "./index.js";

describe("parseArgv", () => {
  it("parses whitespace and quoted values", () => {
    expect(parseArgv('alpha "two words" beta')).toEqual(["alpha", "two words", "beta"]);
  });

  it("supports escaped spaces", () => {
    expect(parseArgv("one two\\ words")).toEqual(["one", "two words"]);
  });

  it("rejects unclosed quotes", () => {
    expect(() => parseArgv('"missing')).toThrow("Unclosed quote");
  });
});

describe("schemas", () => {
  it("accepts valid run requests", () => {
    const parsed = RunRequestSchema.parse({
      language: "python",
      source: "print('ok')"
    });

    expect(parsed.stdin).toBe("");
    expect(parsed.argv).toEqual([]);
  });

  it("rejects Python debug requests", () => {
    expect(() =>
      DebugRequestSchema.parse({
        language: "python",
        source: "print('no')",
        clientId: "browser"
      })
    ).toThrow();
  });

  it("declares Python as run-only", () => {
    const python = LANGUAGE_CAPABILITIES.find((language) => language.id === "python");
    expect(python?.run).toBe(true);
    expect(python?.debug).toBe(false);
  });
});
