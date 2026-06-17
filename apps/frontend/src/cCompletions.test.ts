import { describe, expect, it } from "vitest";
import { computeSignatureHelp, __test } from "./cCompletions";

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
});

describe("computeSignatureHelp", () => {
  it("returns the call name and first argument at the open paren", () => {
    expect(computeSignatureHelp("printf(")).toEqual({ name: "printf", activeParameter: 0 });
  });

  it("counts commas at the call depth", () => {
    expect(computeSignatureHelp("memcpy(dst, ")).toEqual({ name: "memcpy", activeParameter: 1 });
    expect(computeSignatureHelp("memcpy(dst, src, ")).toEqual({ name: "memcpy", activeParameter: 2 });
  });

  it("ignores commas inside string literals", () => {
    expect(computeSignatureHelp('printf("a,b", ')).toEqual({ name: "printf", activeParameter: 1 });
  });

  it("ignores commas inside char literals", () => {
    expect(computeSignatureHelp("printf('x', ")).toEqual({ name: "printf", activeParameter: 1 });
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
