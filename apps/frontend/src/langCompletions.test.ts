import { describe, expect, it } from "vitest";
import { computeSignatureHelp, __test } from "./langCompletions";

describe("symbol table", () => {
  it("includes core C functions with detail + params", () => {
    const byName = new Map(__test.C_SYMBOLS.map((s) => [s.label, s]));
    for (const name of ["printf", "malloc", "strlen", "memcpy"]) {
      const sym = byName.get(name);
      expect(sym, name).toBeDefined();
      expect(sym?.kind).toBe("function");
      expect(sym?.detail).toMatch(name);
      expect(Array.isArray(sym?.params)).toBe(true);
    }
  });

  it("offers C++ std members as bare labels (no `std::` in insertText) to avoid std::std::", () => {
    const cout = __test.CPP_EXTRA_SYMBOLS.find((s) => s.label === "cout");
    expect(cout).toBeDefined();
    expect(cout?.insertText).toBe("cout");
    expect(cout?.detail).toBe("std::cout");
  });

  it("includes core Python builtins with detail + params", () => {
    const byName = new Map(__test.PYTHON_SYMBOLS.map((s) => [s.label, s]));
    for (const name of ["print", "len", "range", "enumerate"]) {
      const sym = byName.get(name);
      expect(sym, name).toBeDefined();
      expect(sym?.kind).toBe("function");
      expect(Array.isArray(sym?.params)).toBe(true);
    }
    expect(byName.get("None")?.kind).toBe("constant");
    expect(byName.get("def")?.kind).toBe("keyword");
  });

  it("includes core Java members with detail + params", () => {
    const byName = new Map(__test.JAVA_SYMBOLS.map((s) => [s.label, s]));
    for (const name of ["println", "nextInt", "parseInt"]) {
      const sym = byName.get(name);
      expect(sym, name).toBeDefined();
      expect(sym?.kind).toBe("function");
      expect(Array.isArray(sym?.params)).toBe(true);
    }
    expect(byName.get("System")?.kind).toBe("type");
    expect(byName.get("out")?.detail).toBe("System.out");
    expect(byName.get("class")?.kind).toBe("keyword");
  });

  it("keeps Java labels unique (provider maps the whole array with no dedup)", () => {
    const labels = __test.JAVA_SYMBOLS.map((s) => s.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("exposes Java live-template abbreviations as dot-free snippets", () => {
    const sout = __test.JAVA_SYMBOLS.find((s) => s.label === "sout");
    expect(sout?.kind).toBe("snippet");
    expect(sout?.label).not.toContain(".");
    expect(sout?.insertText).toContain("System.out.println");
  });
});

describe("ISSUE-063: accepting a function surfaces its parameters", () => {
  it("builds parameterized snippets (not empty parens) so params show inline", () => {
    expect(__test.fnSnippet("printf", ["const char *format", "..."])).toBe(
      "printf(${1:const char *format}, ${2:...})"
    );
  });

  it("emits bare parens for zero-arg functions and no trigger command", () => {
    expect(__test.fnSnippet("getchar", [])).toBe("getchar()");
    const getchar = __test.C_SYMBOLS.find((s) => s.label === "getchar");
    expect(getchar?.insertText).toBe("getchar()");
    expect(getchar?.command).toBeUndefined();
  });

  it("escapes snippet metacharacters in parameter text", () => {
    expect(__test.fnSnippet("f", ["a$b}c"])).toBe("f(${1:a\\$b\\}c})");
  });

  it("attaches the trigger-parameter-hints command to functions with params", () => {
    const printf = __test.C_SYMBOLS.find((s) => s.label === "printf");
    expect(printf?.insertText).toMatch(/^printf\(\$\{1:/);
    expect(printf?.insertText).toContain("const char *format");
    expect(printf?.command?.id).toBe("editor.action.triggerParameterHints");
  });

  it("applies the same parameterized shape to Python functions", () => {
    const print = __test.PYTHON_SYMBOLS.find((s) => s.label === "print");
    expect(print?.insertText).toMatch(/^print\(\$\{1:/);
    expect(print?.command?.id).toBe("editor.action.triggerParameterHints");
  });
});

describe("computeSignatureHelp", () => {
  it("returns the call name and first argument at the open paren", () => {
    expect(computeSignatureHelp("printf(")).toEqual({ name: "printf", activeParameter: 0 });
  });

  it("counts commas at the call depth", () => {
    expect(computeSignatureHelp("memcpy(dst, ")).toEqual({ name: "memcpy", activeParameter: 1 });
    expect(computeSignatureHelp("memcpy(dst, src, ")).toEqual({ name: "memcpy", activeParameter: 2 });
  });

  it("works for Python calls too", () => {
    expect(computeSignatureHelp("print(")).toEqual({ name: "print", activeParameter: 0 });
    expect(computeSignatureHelp("range(0, ")).toEqual({ name: "range", activeParameter: 1 });
  });

  it("resolves a Java dotted receiver to the bare method label", () => {
    expect(computeSignatureHelp("System.out.println(")).toEqual({ name: "println", activeParameter: 0 });
  });

  it("ignores commas inside string literals", () => {
    expect(computeSignatureHelp('printf("a,b", ')).toEqual({ name: "printf", activeParameter: 1 });
  });

  it("ignores commas inside char literals", () => {
    expect(computeSignatureHelp("printf('x', ")).toEqual({ name: "printf", activeParameter: 1 });
  });

  it("ignores commas inside backtick template/raw literals", () => {
    expect(computeSignatureHelp("f(`a, b`, ")).toEqual({ name: "f", activeParameter: 1 });
  });

  it("handles escaped quotes inside strings", () => {
    expect(computeSignatureHelp('printf("x\\"y,z", ')).toEqual({ name: "printf", activeParameter: 1 });
  });

  it("ignores already-closed sibling calls", () => {
    expect(computeSignatureHelp("foo(a, b); printf(")).toEqual({ name: "printf", activeParameter: 0 });
  });

  it("does not count commas inside nested brackets/array initializers", () => {
    expect(computeSignatureHelp("qsort(arr[1, 2], ")).toEqual({ name: "qsort", activeParameter: 1 });
  });

  it("resolves the innermost call for nested calls", () => {
    expect(computeSignatureHelp("printf(\"%d\", strlen(")).toEqual({ name: "strlen", activeParameter: 0 });
  });

  it("returns null when not inside any call", () => {
    expect(computeSignatureHelp("int x = 1; ")).toBeNull();
  });
});
