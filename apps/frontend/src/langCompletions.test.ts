import { describe, expect, it, vi } from "vitest";
import {
  computeSignatureHelp,
  supportsSuggestionToggle,
  setJavascriptSuggestions,
  __test
} from "./langCompletions";

type MonacoArg = Parameters<typeof setJavascriptSuggestions>[0];

// Minimal fake of the `monaco.languages.typescript.javascriptDefaults` surface.
function fakeMonaco(modeConfiguration: Record<string, boolean>, setSpy: (c: unknown) => void) {
  return {
    languages: {
      typescript: {
        javascriptDefaults: { modeConfiguration, setModeConfiguration: setSpy }
      }
    }
  } as unknown as MonacoArg;
}

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

  it("includes core Go members + builtins with detail + params", () => {
    const byName = new Map(__test.GO_SYMBOLS.map((s) => [s.label, s]));
    for (const name of ["Println", "Split", "Atoi", "len"]) {
      const sym = byName.get(name);
      expect(sym, name).toBeDefined();
      expect(sym?.kind).toBe("function");
      expect(Array.isArray(sym?.params)).toBe(true);
    }
    expect(byName.get("func")?.kind).toBe("keyword");
    expect(byName.get("iferr")?.kind).toBe("snippet");
  });

  it("includes core Rust methods + macros, with the bang kept in macro labels", () => {
    const byName = new Map(__test.RUST_SYMBOLS.map((s) => [s.label, s]));
    const println = byName.get("println!");
    expect(println?.kind).toBe("function");
    expect(println?.insertText).toMatch(/^println!\(/);
    expect(println?.command?.id).toBe("editor.action.triggerParameterHints");
    for (const name of ["push", "unwrap", "collect"]) {
      expect(byName.get(name)?.kind, name).toBe("function");
    }
    expect(byName.get("None")?.kind).toBe("constant");
    expect(byName.get("fn")?.kind).toBe("keyword");
  });

  it("keeps Go and Rust labels unique (no dedup in the provider)", () => {
    for (const table of [__test.GO_SYMBOLS, __test.RUST_SYMBOLS]) {
      const labels = table.map((s) => s.label);
      expect(new Set(labels).size).toBe(labels.length);
    }
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

  it("resolves a Go package-qualified receiver to the bare member label", () => {
    expect(computeSignatureHelp("fmt.Println(")).toEqual({ name: "Println", activeParameter: 0 });
  });

  it("does not count commas inside a Go raw (backtick) string", () => {
    expect(computeSignatureHelp("fmt.Println(`a, b`, ")).toEqual({ name: "Println", activeParameter: 1 });
  });

  it("captures the bang of a Rust macro call", () => {
    expect(computeSignatureHelp("println!(")).toEqual({ name: "println!", activeParameter: 0 });
  });

  it("treats a bare logical-not before a paren as a non-symbol name", () => {
    // `!(a, ` resolves to name "!" (no symbol) and must not throw.
    expect(computeSignatureHelp("return !(a, ")).toEqual({ name: "!", activeParameter: 1 });
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

describe("JavaScript: gate the built-in TS worker (Wave 4)", () => {
  it("offers the toggle for JavaScript and static-table languages", () => {
    expect(supportsSuggestionToggle("javascript")).toBe(true);
    expect(supportsSuggestionToggle("c")).toBe(true);
  });

  it("disables only TS completion + signature help when turned off, preserving the rest", () => {
    const setSpy = vi.fn();
    const monaco = fakeMonaco({ completionItems: true, signatureHelp: true, hovers: true }, setSpy);
    const disposable = setJavascriptSuggestions(monaco, false);
    expect(setSpy).toHaveBeenCalledWith({ completionItems: false, signatureHelp: false, hovers: true });
    // Disposing restores the captured original config (back to full IntelliSense).
    disposable?.dispose();
    expect(setSpy).toHaveBeenLastCalledWith({ completionItems: true, signatureHelp: true, hovers: true });
  });

  it("restores TS completion + signature help when turned on", () => {
    const setSpy = vi.fn();
    const monaco = fakeMonaco({ completionItems: false, signatureHelp: false, hovers: true }, setSpy);
    setJavascriptSuggestions(monaco, true);
    expect(setSpy).toHaveBeenCalledWith({ completionItems: true, signatureHelp: true, hovers: true });
  });

  it("returns null when the TypeScript worker is unavailable", () => {
    const monaco = { languages: { typescript: undefined } } as unknown as MonacoArg;
    expect(setJavascriptSuggestions(monaco, false)).toBeNull();
  });
});
