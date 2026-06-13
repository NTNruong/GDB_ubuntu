import { describe, expect, it } from "vitest";
import { assertSafeFileName } from "./workspace.js";

describe("assertSafeFileName", () => {
  it("accepts valid flat C/C++ file names", () => {
    expect(() => assertSafeFileName("main.c", "c")).not.toThrow();
    expect(() => assertSafeFileName("gpio_driver.h", "c")).not.toThrow();
    expect(() => assertSafeFileName("Widget.cpp", "cpp")).not.toThrow();
    expect(() => assertSafeFileName("api.hpp", "cpp")).not.toThrow();
  });

  it("rejects path traversal and separators", () => {
    for (const name of ["../evil.c", "sub/dir.c", "a\\b.c", "..", "."]) {
      expect(() => assertSafeFileName(name, "c")).toThrow();
    }
  });

  it("rejects hidden and reserved names", () => {
    for (const name of [".gdbinit", "stdin.txt", "program.out", "scratch.txt"]) {
      expect(() => assertSafeFileName(name, "c")).toThrow();
    }
    expect(() => assertSafeFileName("__debugpy_runner.py", "python")).toThrow();
  });

  it("enforces per-language extensions", () => {
    expect(() => assertSafeFileName("main.cpp", "c")).toThrow();
    expect(() => assertSafeFileName("main.py", "c")).toThrow();
    expect(() => assertSafeFileName("main.c", "python")).toThrow();
    expect(() => assertSafeFileName("legacy.h", "cpp")).not.toThrow();
  });

  it("accepts JavaScript and Java file names", () => {
    expect(() => assertSafeFileName("main.js", "javascript")).not.toThrow();
    expect(() => assertSafeFileName("util.mjs", "javascript")).not.toThrow();
    expect(() => assertSafeFileName("Main.java", "java")).not.toThrow();
    expect(() => assertSafeFileName("main.py", "javascript")).toThrow();
    expect(() => assertSafeFileName("Main.java", "javascript")).toThrow();
    expect(() => assertSafeFileName("main.js", "java")).toThrow();
  });
});
