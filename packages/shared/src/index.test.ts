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
      files: [{ path: "main.py", content: "print('ok')" }]
    });

    expect(parsed.stdin).toBe("");
    expect(parsed.argv).toEqual([]);
  });

  it("accepts Python debug requests", () => {
    const parsed = DebugRequestSchema.parse({
      language: "python",
      files: [{ path: "main.py", content: "print('ok')" }],
      breakpoints: [{ path: "main.py", line: 1 }],
      clientId: "browser"
    });

    expect(parsed.language).toBe("python");
    expect(parsed.breakpoints).toEqual([{ path: "main.py", line: 1 }]);
  });

  it("declares Python as debuggable", () => {
    const python = LANGUAGE_CAPABILITIES.find((language) => language.id === "python");
    expect(python?.run).toBe(true);
    expect(python?.debug).toBe(true);
  });

  it("uses compact language labels and defaults to C", () => {
    expect(LANGUAGE_CAPABILITIES.map((language) => language.id)).toEqual([
      "c",
      "cpp",
      "python",
      "javascript",
      "java"
    ]);
    expect(LANGUAGE_CAPABILITIES.map((language) => language.label)).toEqual([
      "C",
      "C++",
      "Python",
      "JavaScript",
      "Java"
    ]);
  });

  it("declares JavaScript and Java as run-only (no debugger yet)", () => {
    for (const id of ["javascript", "java"] as const) {
      const capability = LANGUAGE_CAPABILITIES.find((language) => language.id === id);
      expect(capability?.run).toBe(true);
      expect(capability?.debug).toBe(false);
    }
  });

  it("uses simple Hello World starter sources", () => {
    for (const capability of LANGUAGE_CAPABILITIES) {
      expect(capability.defaultSource).toContain("Hello World");
      expect(capability.defaultSource).not.toContain("argc");
      expect(capability.defaultSource).not.toContain("input()");
      expect(capability.defaultSource).not.toContain("scanf");
    }
  });
});

describe("multi-file validation", () => {
  const cFiles = (...names: string[]) => names.map((path) => ({ path, content: "int x;" }));

  it("accepts a C project with a header and multiple sources", () => {
    const parsed = RunRequestSchema.parse({
      language: "c",
      files: [
        { path: "main.c", content: "#include \"util.h\"\nint main(){ return 0; }" },
        { path: "util.c", content: "int util(){ return 1; }" },
        { path: "util.h", content: "int util();" }
      ]
    });
    expect(parsed.files).toHaveLength(3);
  });

  it("rejects path traversal and slashes in file names", () => {
    for (const path of ["../evil.c", "sub/dir.c", "..", ".", "/abs.c"]) {
      expect(() => RunRequestSchema.parse({ language: "c", files: [{ path, content: "x" }] })).toThrow();
    }
  });

  it("rejects hidden / reserved file names", () => {
    for (const path of [".gdbinit", "stdin.txt", "program.out", "scratch.txt"]) {
      expect(() => RunRequestSchema.parse({ language: "c", files: [{ path, content: "x" }] })).toThrow();
    }
  });

  it("blocks __debugpy_runner.py even though .py is allowed", () => {
    expect(() =>
      RunRequestSchema.parse({ language: "python", files: [{ path: "__debugpy_runner.py", content: "x" }] })
    ).toThrow();
  });

  it("enforces per-language extensions", () => {
    expect(() => RunRequestSchema.parse({ language: "c", files: cFiles("main.cpp") })).toThrow();
    expect(() => RunRequestSchema.parse({ language: "c", files: cFiles("main.py") })).toThrow();
    expect(() => RunRequestSchema.parse({ language: "python", files: cFiles("main.c") })).toThrow();
    // C++ accepts shared headers.
    expect(() => RunRequestSchema.parse({ language: "cpp", files: cFiles("main.cpp", "api.hpp", "legacy.h") })).not.toThrow();
    // JavaScript + Java accept their own extensions and reject foreign ones.
    expect(() => RunRequestSchema.parse({ language: "javascript", files: cFiles("main.js", "util.mjs") })).not.toThrow();
    expect(() => RunRequestSchema.parse({ language: "javascript", files: cFiles("main.py") })).toThrow();
    expect(() => RunRequestSchema.parse({ language: "java", files: cFiles("Main.java", "Helper.java") })).not.toThrow();
    expect(() => RunRequestSchema.parse({ language: "java", files: cFiles("main.js") })).toThrow();
  });

  it("rejects case-insensitive duplicate file names", () => {
    expect(() => RunRequestSchema.parse({ language: "c", files: cFiles("Main.c", "main.c") })).toThrow();
  });

  it("rejects more than MAX_FILES files", () => {
    const files = Array.from({ length: 21 }, (_, i) => ({ path: `f${i}.c`, content: "x" }));
    expect(() => RunRequestSchema.parse({ language: "c", files })).toThrow();
  });

  it("rejects projects over the total size cap (each file under per-file max)", () => {
    // 11 files × 199_000 chars = 2.189M > 2M total, each below MAX_SOURCE_BYTES, count below MAX_FILES.
    const files = Array.from({ length: 11 }, (_, i) => ({ path: `f${i}.c`, content: "x".repeat(199_000) }));
    expect(() => RunRequestSchema.parse({ language: "c", files })).toThrow();
  });
});
