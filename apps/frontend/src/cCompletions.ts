import type { OnMount } from "@monaco-editor/react";

// The `monaco` namespace object handed to `onMount` — same type as `monacoRef.current`.
type Monaco = Parameters<OnMount>[1];
type IDisposable = { dispose(): void };

type SymbolKind = "function" | "keyword" | "type" | "macro" | "constant";

export interface LangSymbol {
  /** Text shown in the list and used to match (members like `cout`, not `std::cout`). */
  label: string;
  /** Inserted on accept. For functions this is a snippet (`name($0)`). */
  insertText: string;
  kind: SymbolKind;
  /** Full signature / short type info, shown as detail and used as the signature label. */
  detail: string;
  documentation?: string;
  /** Parameter labels (functions only) — drives signature help. */
  params?: string[];
}

const fn = (label: string, detail: string, params: string[], documentation?: string): LangSymbol => ({
  label,
  insertText: `${label}($0)`,
  kind: "function",
  detail,
  params,
  documentation
});

const kw = (label: string): LangSymbol => ({ label, insertText: label, kind: "keyword", detail: label });
const ty = (label: string, detail = label): LangSymbol => ({ label, insertText: label, kind: "type", detail });
const ct = (label: string, detail = label): LangSymbol => ({ label, insertText: label, kind: "constant", detail });

// --- C standard library (shared by `c` and `cpp`) --------------------------
const C_SYMBOLS: LangSymbol[] = [
  // <stdio.h>
  fn("printf", "int printf(const char *format, ...)", ["const char *format", "..."], "Print formatted output to stdout."),
  fn("scanf", "int scanf(const char *format, ...)", ["const char *format", "..."], "Read formatted input from stdin."),
  fn("fprintf", "int fprintf(FILE *stream, const char *format, ...)", ["FILE *stream", "const char *format", "..."]),
  fn("sprintf", "int sprintf(char *str, const char *format, ...)", ["char *str", "const char *format", "..."]),
  fn("snprintf", "int snprintf(char *str, size_t size, const char *format, ...)", ["char *str", "size_t size", "const char *format", "..."]),
  fn("fopen", "FILE *fopen(const char *path, const char *mode)", ["const char *path", "const char *mode"]),
  fn("fclose", "int fclose(FILE *stream)", ["FILE *stream"]),
  fn("fgets", "char *fgets(char *s, int size, FILE *stream)", ["char *s", "int size", "FILE *stream"]),
  fn("fputs", "int fputs(const char *s, FILE *stream)", ["const char *s", "FILE *stream"]),
  fn("puts", "int puts(const char *s)", ["const char *s"]),
  fn("getchar", "int getchar(void)", []),
  fn("putchar", "int putchar(int c)", ["int c"]),
  fn("perror", "void perror(const char *s)", ["const char *s"]),
  // <stdlib.h>
  fn("malloc", "void *malloc(size_t size)", ["size_t size"]),
  fn("calloc", "void *calloc(size_t nmemb, size_t size)", ["size_t nmemb", "size_t size"]),
  fn("realloc", "void *realloc(void *ptr, size_t size)", ["void *ptr", "size_t size"]),
  fn("free", "void free(void *ptr)", ["void *ptr"]),
  fn("atoi", "int atoi(const char *nptr)", ["const char *nptr"]),
  fn("strtol", "long strtol(const char *nptr, char **endptr, int base)", ["const char *nptr", "char **endptr", "int base"]),
  fn("qsort", "void qsort(void *base, size_t nmemb, size_t size, int (*compar)(const void *, const void *))", ["void *base", "size_t nmemb", "size_t size", "int (*compar)(const void *, const void *)"]),
  fn("exit", "void exit(int status)", ["int status"]),
  fn("abs", "int abs(int j)", ["int j"]),
  fn("rand", "int rand(void)", []),
  fn("srand", "void srand(unsigned int seed)", ["unsigned int seed"]),
  // <string.h>
  fn("strlen", "size_t strlen(const char *s)", ["const char *s"]),
  fn("strcpy", "char *strcpy(char *dest, const char *src)", ["char *dest", "const char *src"]),
  fn("strncpy", "char *strncpy(char *dest, const char *src, size_t n)", ["char *dest", "const char *src", "size_t n"]),
  fn("strcmp", "int strcmp(const char *s1, const char *s2)", ["const char *s1", "const char *s2"]),
  fn("strncmp", "int strncmp(const char *s1, const char *s2, size_t n)", ["const char *s1", "const char *s2", "size_t n"]),
  fn("strcat", "char *strcat(char *dest, const char *src)", ["char *dest", "const char *src"]),
  fn("strchr", "char *strchr(const char *s, int c)", ["const char *s", "int c"]),
  fn("strstr", "char *strstr(const char *haystack, const char *needle)", ["const char *haystack", "const char *needle"]),
  fn("memcpy", "void *memcpy(void *dest, const void *src, size_t n)", ["void *dest", "const void *src", "size_t n"]),
  fn("memmove", "void *memmove(void *dest, const void *src, size_t n)", ["void *dest", "const void *src", "size_t n"]),
  fn("memset", "void *memset(void *s, int c, size_t n)", ["void *s", "int c", "size_t n"]),
  fn("memcmp", "int memcmp(const void *s1, const void *s2, size_t n)", ["const void *s1", "const void *s2", "size_t n"]),
  // <math.h>
  fn("pow", "double pow(double x, double y)", ["double x", "double y"]),
  fn("sqrt", "double sqrt(double x)", ["double x"]),
  fn("fabs", "double fabs(double x)", ["double x"]),
  fn("floor", "double floor(double x)", ["double x"]),
  fn("ceil", "double ceil(double x)", ["double x"]),
  fn("round", "double round(double x)", ["double x"]),
  // types
  ty("size_t"), ty("int32_t"), ty("uint8_t"), ty("uint32_t"), ty("int64_t"), ty("FILE"), ty("bool"),
  // macros / constants
  ct("NULL"), ct("EXIT_SUCCESS"), ct("EXIT_FAILURE"), ct("INT_MAX"), ct("INT_MIN"), ct("true"), ct("false"),
  // keywords
  ...["if", "else", "for", "while", "do", "switch", "case", "default", "break", "continue", "return",
    "struct", "typedef", "enum", "union", "const", "static", "sizeof", "void", "int", "char", "float",
    "double", "long", "short", "unsigned", "signed", "include", "define"].map(kw)
];

// --- C++ extras (member-style labels to avoid `std::std::cout`) -------------
const CPP_EXTRA_SYMBOLS: LangSymbol[] = [
  ct("cout", "std::cout"), ct("cin", "std::cin"), ct("cerr", "std::cerr"), ct("endl", "std::endl"),
  ty("string", "std::string"), ty("vector", "std::vector"), ty("map", "std::map"), ty("pair", "std::pair"),
  fn("make_pair", "std::pair make_pair(T1 x, T2 y)", ["T1 x", "T2 y"]),
  fn("to_string", "std::string to_string(T value)", ["T value"]),
  fn("sort", "void sort(Iter first, Iter last)", ["Iter first", "Iter last"]),
  ...["nullptr", "auto", "class", "namespace", "template", "using", "new", "delete", "public", "private",
    "protected", "virtual", "override", "this", "try", "catch", "throw"].map(kw)
];

export interface SignatureContext {
  /** Identifier of the enclosing (innermost) open call. */
  name: string;
  /** Zero-based index of the argument the cursor is currently in. */
  activeParameter: number;
}

function identifierBefore(text: string, openParenIndex: number): string {
  let j = openParenIndex - 1;
  while (j >= 0 && /\s/.test(text[j] ?? "")) j--;
  const end = j + 1;
  while (j >= 0 && /[A-Za-z0-9_]/.test(text[j] ?? "")) j--;
  return text.slice(j + 1, end);
}

/**
 * Given the text before the cursor, find the innermost open function call and
 * the index of the argument the cursor sits in. Skips string/char literals
 * (with escapes) and ignores already-closed calls and nested brackets so commas
 * inside strings, array initializers, or sibling calls are not miscounted.
 */
export function computeSignatureHelp(text: string): SignatureContext | null {
  const stack: { name: string; argIndex: number }[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i] ?? "";
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      while (i < n) {
        const c = text[i] ?? "";
        if (c === "\\") {
          i += 2;
          continue;
        }
        i++;
        if (c === quote) break;
      }
      continue;
    }
    if (ch === "(") {
      stack.push({ name: identifierBefore(text, i), argIndex: 0 });
    } else if (ch === "[" || ch === "{") {
      stack.push({ name: "", argIndex: 0 });
    } else if (ch === ")" || ch === "]" || ch === "}") {
      stack.pop();
    } else if (ch === "," && stack.length > 0) {
      stack[stack.length - 1]!.argIndex++;
    }
    i++;
  }
  for (let k = stack.length - 1; k >= 0; k--) {
    const frame = stack[k]!;
    if (frame.name) return { name: frame.name, activeParameter: frame.argIndex };
  }
  return null;
}

function registerForLanguage(monaco: Monaco, languageId: string, symbols: LangSymbol[]): IDisposable[] {
  const byName = new Map(symbols.map((s) => [s.label, s]));
  const kindOf = (kind: SymbolKind): number => {
    const K = monaco.languages.CompletionItemKind;
    switch (kind) {
      case "function":
        return K.Function;
      case "keyword":
        return K.Keyword;
      case "type":
        return K.Class;
      default:
        return K.Constant;
    }
  };

  const completion = monaco.languages.registerCompletionItemProvider(languageId, {
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn
      };
      return {
        suggestions: symbols.map((sym) => ({
          label: sym.label,
          kind: kindOf(sym.kind),
          detail: sym.detail,
          documentation: sym.documentation,
          insertText: sym.insertText,
          insertTextRules:
            sym.kind === "function"
              ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
              : undefined,
          range
        }))
      };
    }
  });

  const signature = monaco.languages.registerSignatureHelpProvider(languageId, {
    signatureHelpTriggerCharacters: ["("],
    signatureHelpRetriggerCharacters: [","],
    provideSignatureHelp(model, position) {
      const textBefore = model.getValueInRange({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column
      });
      const ctx = computeSignatureHelp(textBefore);
      if (!ctx) return null;
      const sym = byName.get(ctx.name);
      if (!sym || sym.kind !== "function" || !sym.params || sym.params.length === 0) return null;
      const activeParameter = Math.min(ctx.activeParameter, sym.params.length - 1);
      return {
        value: {
          signatures: [{ label: sym.detail, parameters: sym.params.map((p) => ({ label: p })) }],
          activeSignature: 0,
          activeParameter
        },
        dispose() {}
      };
    }
  });

  return [completion, signature];
}

/**
 * Register static C/C++ standard-library completion + signature help providers.
 * Returns a disposable that tears down every registered provider — call it when
 * the advanced-suggestions switch turns off or the editor language changes.
 */
export function registerCSuggestions(monaco: Monaco): IDisposable {
  const disposables: IDisposable[] = [
    ...registerForLanguage(monaco, "c", C_SYMBOLS),
    ...registerForLanguage(monaco, "cpp", [...C_SYMBOLS, ...CPP_EXTRA_SYMBOLS])
  ];
  return {
    dispose() {
      for (const d of disposables) d.dispose();
    }
  };
}

// Exposed for tests.
export const __test = { C_SYMBOLS, CPP_EXTRA_SYMBOLS };
