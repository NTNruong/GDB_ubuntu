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

  it("accepts Python debug requests", () => {
    const parsed = DebugRequestSchema.parse({
      language: "python",
      source: "print('ok')",
      clientId: "browser"
    });

    expect(parsed.language).toBe("python");
  });

  it("declares Python as debuggable", () => {
    const python = LANGUAGE_CAPABILITIES.find((language) => language.id === "python");
    expect(python?.run).toBe(true);
    expect(python?.debug).toBe(true);
  });
});
