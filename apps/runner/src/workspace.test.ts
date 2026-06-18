import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertSafeFileName, writeProjectFiles } from "./workspace.js";

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

  it("accepts Go and Rust file names", () => {
    expect(() => assertSafeFileName("main.go", "go")).not.toThrow();
    expect(() => assertSafeFileName("util.go", "go")).not.toThrow();
    expect(() => assertSafeFileName("main.rs", "rust")).not.toThrow();
    expect(() => assertSafeFileName("main.rs", "go")).toThrow();
    expect(() => assertSafeFileName("main.go", "rust")).toThrow();
  });

  it("accepts nested Python package paths but still rejects traversal/hidden", () => {
    expect(() => assertSafeFileName("pkg/util.py", "python")).not.toThrow();
    expect(() => assertSafeFileName("pkg/sub/deep.py", "python")).not.toThrow();
    expect(() => assertSafeFileName("../evil.py", "python")).toThrow();
    expect(() => assertSafeFileName("pkg/.hidden.py", "python")).toThrow();
    // Reserved name + wrong extension are still checked on the basename.
    expect(() => assertSafeFileName("pkg/__debugpy_runner.py", "python")).toThrow();
    expect(() => assertSafeFileName("pkg/util.c", "python")).toThrow();
    // Other languages stay flat — a nested path is rejected.
    expect(() => assertSafeFileName("pkg/util.go", "go")).toThrow();
  });
});

describe("writeProjectFiles", () => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "ws-nested-"));
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("creates parent directories for nested Python files", async () => {
    await writeProjectFiles(
      root,
      [
        { path: "main.py", content: "import pkg.util" },
        { path: "pkg/util.py", content: "x = 1" }
      ],
      "python"
    );
    expect((await stat(path.join(root, "pkg"))).isDirectory()).toBe(true);
    expect(await readFile(path.join(root, "pkg", "util.py"), "utf8")).toBe("x = 1");
  });

  it("refuses to write a traversal path", async () => {
    await expect(
      writeProjectFiles(root, [{ path: "../escape.py", content: "x" }], "python")
    ).rejects.toThrow();
  });
});
