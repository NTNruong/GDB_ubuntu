import type { OnMount } from "@monaco-editor/react";
import type { Language } from "@internal/shared";

// The `monaco` namespace object handed to `onMount` — same type as `monacoRef.current`.
type Monaco = Parameters<OnMount>[1];
type IDisposable = { dispose(): void };

type SymbolKind = "function" | "keyword" | "type" | "macro" | "constant" | "snippet";

export interface LangSymbol {
  /** Text shown in the list and used to match (members like `cout`, not `std::cout`). */
  label: string;
  /** Inserted on accept. For functions this is a parameterized snippet. */
  insertText: string;
  kind: SymbolKind;
  /** Full signature / short type info, shown as detail and used as the signature label. */
  detail: string;
  documentation?: string;
  /** Parameter labels (functions only) — drives signature help. */
  params?: string[];
  /** Command run on completion acceptance (e.g. trigger parameter hints). */
  command?: { id: string; title: string };
}

// Snippet placeholders only need `$`, `}`, `\` escaped; param text (commas, parens) is literal.
const escapeSnippet = (s: string): string => s.replace(/[\\$}]/g, (m) => `\\${m}`);

// Build a parameterized snippet so accepting a function shows its parameters inline
// (tab-stops), instead of empty `name()` — see ISSUE-063.
function fnSnippet(label: string, params: string[]): string {
  if (params.length === 0) return `${label}()`;
  const placeholders = params.map((p, i) => `\${${i + 1}:${escapeSnippet(p)}}`);
  return `${label}(${placeholders.join(", ")})`;
}

const fn = (label: string, detail: string, params: string[], documentation?: string): LangSymbol => ({
  label,
  insertText: fnSnippet(label, params),
  kind: "function",
  detail,
  params,
  documentation,
  // Pop the signature-help widget right after acceptance so parameter guidance is visible.
  command: params.length > 0 ? { id: "editor.action.triggerParameterHints", title: "Parameter hints" } : undefined
});

const kw = (label: string): LangSymbol => ({ label, insertText: label, kind: "keyword", detail: label });
const ty = (label: string, detail = label): LangSymbol => ({ label, insertText: label, kind: "type", detail });
const ct = (label: string, detail = label): LangSymbol => ({ label, insertText: label, kind: "constant", detail });
// A live-template-style abbreviation (no dots in the label, so the default word range
// works) whose insertText is a full snippet — e.g. `sout` → `System.out.println(...)`.
const snip = (label: string, insertText: string, detail: string): LangSymbol => ({
  label,
  insertText,
  kind: "snippet",
  detail
});

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

// --- Python builtins -------------------------------------------------------
const PYTHON_SYMBOLS: LangSymbol[] = [
  // builtin functions
  fn("print", "print(*objects, sep=' ', end='\\n', file=sys.stdout)", ["*objects", "sep=' '", "end='\\n'", "file=sys.stdout"], "Print objects to the text stream."),
  fn("len", "len(s)", ["s"], "Return the number of items in a container."),
  fn("range", "range(start, stop[, step])", ["start", "stop", "step"]),
  fn("input", "input(prompt='')", ["prompt=''"]),
  fn("enumerate", "enumerate(iterable, start=0)", ["iterable", "start=0"]),
  fn("zip", "zip(*iterables)", ["*iterables"]),
  fn("map", "map(func, *iterables)", ["func", "*iterables"]),
  fn("filter", "filter(function, iterable)", ["function", "iterable"]),
  fn("sorted", "sorted(iterable, *, key=None, reverse=False)", ["iterable", "key=None", "reverse=False"]),
  fn("sum", "sum(iterable, /, start=0)", ["iterable", "start=0"]),
  fn("min", "min(iterable, *, key=None, default=...)", ["iterable", "key=None", "default=..."]),
  fn("max", "max(iterable, *, key=None, default=...)", ["iterable", "key=None", "default=..."]),
  fn("abs", "abs(x)", ["x"]),
  fn("round", "round(number, ndigits=None)", ["number", "ndigits=None"]),
  fn("open", "open(file, mode='r', encoding=None)", ["file", "mode='r'", "encoding=None"]),
  fn("isinstance", "isinstance(obj, classinfo)", ["obj", "classinfo"]),
  fn("type", "type(object)", ["object"]),
  fn("ord", "ord(c)", ["c"]),
  fn("chr", "chr(i)", ["i"]),
  fn("hex", "hex(x)", ["x"]),
  fn("bin", "bin(x)", ["x"]),
  fn("oct", "oct(x)", ["x"]),
  fn("any", "any(iterable)", ["iterable"]),
  fn("all", "all(iterable)", ["iterable"]),
  fn("reversed", "reversed(seq)", ["seq"]),
  fn("format", "format(value, format_spec='')", ["value", "format_spec=''"]),
  fn("repr", "repr(obj)", ["obj"]),
  // constructor-style builtins (callable types) — keep params so signature help works
  fn("int", "int(x=0, base=10)", ["x=0", "base=10"]),
  fn("str", "str(object='')", ["object=''"]),
  fn("float", "float(x=0.0)", ["x=0.0"]),
  fn("list", "list(iterable=())", ["iterable=()"]),
  fn("dict", "dict(**kwargs)", ["**kwargs"]),
  fn("set", "set(iterable=())", ["iterable=()"]),
  fn("tuple", "tuple(iterable=())", ["iterable=()"]),
  fn("bool", "bool(x=False)", ["x=False"]),
  // constants
  ct("True"), ct("False"), ct("None"),
  // keywords
  ...["def", "class", "return", "if", "elif", "else", "for", "while", "import", "from", "as", "with",
    "try", "except", "finally", "raise", "lambda", "yield", "async", "await", "pass", "break",
    "continue", "global", "nonlocal", "in", "is", "not", "and", "or", "del", "assert"].map(kw)
];

// --- Java standard library -------------------------------------------------
// Member methods use BARE labels (e.g. `println`, not `System.out.println`) so they
// complete after the user types the receiver + dot — Monaco's word range splits on `.`,
// exactly like the C++ `cout` convention. Labels must be UNIQUE (the provider maps the
// whole array with no dedup), so methods that exist on several classes appear once with
// a representative signature.
const JAVA_SYMBOLS: LangSymbol[] = [
  // PrintStream (System.out / System.err)
  fn("println", "void println(Object x)", ["Object x"], "Print a line to the stream."),
  fn("print", "void print(Object x)", ["Object x"]),
  fn("printf", "PrintStream printf(String format, Object... args)", ["String format", "Object... args"]),
  fn("format", "String format(String format, Object... args)", ["String format", "Object... args"]),
  // Scanner
  fn("nextInt", "int nextInt()", []),
  fn("nextLine", "String nextLine()", []),
  fn("next", "String next()", []),
  fn("nextDouble", "double nextDouble()", []),
  fn("nextLong", "long nextLong()", []),
  fn("hasNext", "boolean hasNext()", []),
  fn("hasNextInt", "boolean hasNextInt()", []),
  fn("hasNextLine", "boolean hasNextLine()", []),
  fn("close", "void close()", []),
  // String
  fn("length", "int length()", []),
  fn("charAt", "char charAt(int index)", ["int index"]),
  fn("substring", "String substring(int beginIndex, int endIndex)", ["int beginIndex", "int endIndex"]),
  fn("indexOf", "int indexOf(String str)", ["String str"]),
  fn("equals", "boolean equals(Object other)", ["Object other"]),
  fn("equalsIgnoreCase", "boolean equalsIgnoreCase(String other)", ["String other"]),
  fn("compareTo", "int compareTo(T other)", ["T other"]),
  fn("toUpperCase", "String toUpperCase()", []),
  fn("toLowerCase", "String toLowerCase()", []),
  fn("trim", "String trim()", []),
  fn("split", "String[] split(String regex)", ["String regex"]),
  fn("replace", "String replace(CharSequence target, CharSequence replacement)", ["CharSequence target", "CharSequence replacement"]),
  fn("contains", "boolean contains(CharSequence s)", ["CharSequence s"]),
  fn("startsWith", "boolean startsWith(String prefix)", ["String prefix"]),
  fn("endsWith", "boolean endsWith(String suffix)", ["String suffix"]),
  fn("isEmpty", "boolean isEmpty()", []),
  // Integer / Double (static)
  fn("parseInt", "int Integer.parseInt(String s)", ["String s"]),
  fn("parseDouble", "double Double.parseDouble(String s)", ["String s"]),
  fn("parseLong", "long Long.parseLong(String s)", ["String s"]),
  fn("valueOf", "T valueOf(String s)", ["String s"]),
  fn("toBinaryString", "String Integer.toBinaryString(int i)", ["int i"]),
  fn("toHexString", "String Integer.toHexString(int i)", ["int i"]),
  // Math (static)
  fn("abs", "int Math.abs(int a)", ["int a"]),
  fn("max", "int Math.max(int a, int b)", ["int a", "int b"]),
  fn("min", "int Math.min(int a, int b)", ["int a", "int b"]),
  fn("sqrt", "double Math.sqrt(double a)", ["double a"]),
  fn("pow", "double Math.pow(double a, double b)", ["double a", "double b"]),
  fn("floor", "double Math.floor(double a)", ["double a"]),
  fn("ceil", "double Math.ceil(double a)", ["double a"]),
  fn("round", "long Math.round(double a)", ["double a"]),
  fn("random", "double Math.random()", []),
  // Arrays / Collections (static; one owner per label)
  fn("sort", "void Arrays.sort(T[] a)", ["T[] a"]),
  fn("toString", "String toString()", []),
  fn("asList", "List<T> Arrays.asList(T... a)", ["T... a"]),
  fn("fill", "void Arrays.fill(T[] a, T val)", ["T[] a", "T val"]),
  fn("binarySearch", "int Arrays.binarySearch(T[] a, T key)", ["T[] a", "T key"]),
  fn("reverse", "void Collections.reverse(List<?> list)", ["List<?> list"]),
  // Collection / Map instance
  fn("add", "boolean add(E e)", ["E e"]),
  fn("get", "E get(int index)", ["int index"]),
  fn("set", "E set(int index, E element)", ["int index", "E element"]),
  fn("remove", "boolean remove(Object o)", ["Object o"]),
  fn("size", "int size()", []),
  fn("clear", "void clear()", []),
  fn("put", "V put(K key, V value)", ["K key", "V value"]),
  fn("containsKey", "boolean containsKey(Object key)", ["Object key"]),
  fn("getOrDefault", "V getOrDefault(Object key, V defaultValue)", ["Object key", "V defaultValue"]),
  fn("keySet", "Set<K> keySet()", []),
  fn("values", "Collection<V> values()", []),
  // StringBuilder
  fn("append", "StringBuilder append(Object obj)", ["Object obj"]),
  fn("insert", "StringBuilder insert(int offset, Object obj)", ["int offset", "Object obj"]),
  fn("deleteCharAt", "StringBuilder deleteCharAt(int index)", ["int index"]),
  // Object
  fn("hashCode", "int hashCode()", []),
  fn("getClass", "Class<?> getClass()", []),
  // live-template abbreviations (no dots → default range works)
  snip("sout", "System.out.println(${1});", "System.out.println(...)"),
  snip("souf", 'System.out.printf(${1:"%s%n"}, ${2:args});', "System.out.printf(...)"),
  snip("serr", "System.err.println(${1});", "System.err.println(...)"),
  snip("scanner", "Scanner ${1:sc} = new Scanner(System.in);", "new Scanner(System.in)"),
  snip("fori", "for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t${3}\n}", "for-loop with index"),
  snip("psvm", "public static void main(String[] args) {\n\t${1}\n}", "public static void main"),
  // top-level types / objects (bare)
  ty("String"), ty("Integer"), ty("Double"), ty("Long"), ty("Boolean"), ty("Character"),
  ty("System"), ty("Math"), ty("Scanner"), ty("Arrays"), ty("Collections"),
  ty("List"), ty("ArrayList"), ty("LinkedList"), ty("Map"), ty("HashMap"), ty("TreeMap"),
  ty("Set"), ty("HashSet"), ty("TreeSet"), ty("StringBuilder"), ty("Object"), ty("Optional"),
  ty("Comparator"), ty("Comparable"), ty("Iterator"), ty("Exception"), ty("RuntimeException"),
  ty("Stream"), ty("Thread"), ty("Runnable"),
  // members / static fields (bare)
  ct("out", "System.out"), ct("err", "System.err"), ct("in", "System.in"),
  ct("MAX_VALUE", "Integer.MAX_VALUE"), ct("MIN_VALUE", "Integer.MIN_VALUE"),
  ct("PI", "Math.PI"), ct("E", "Math.E"),
  // keywords
  ...["public", "private", "protected", "class", "interface", "enum", "extends", "implements",
    "static", "final", "abstract", "void", "int", "double", "float", "long", "short", "byte",
    "char", "boolean", "return", "if", "else", "for", "while", "do", "switch", "case", "default",
    "break", "continue", "new", "this", "super", "try", "catch", "finally", "throw", "throws",
    "import", "package", "null", "true", "false", "instanceof", "synchronized", "var", "record"].map(kw)
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
 * the index of the argument the cursor sits in. Skips string/char/backtick
 * literals (with escapes) and ignores already-closed calls and nested brackets
 * so commas inside strings, template/raw literals, array initializers, or
 * sibling calls are not miscounted.
 */
export function computeSignatureHelp(text: string): SignatureContext | null {
  const stack: { name: string; argIndex: number }[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i] ?? "";
    if (ch === '"' || ch === "'" || ch === "`") {
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
      case "snippet":
        return K.Snippet;
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
            sym.kind === "function" || sym.kind === "snippet"
              ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
              : undefined,
          command: sym.command,
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

// Static standard-library symbol tables, keyed by the editor's `Language` id (which
// matches the Monaco language id). Add a language here to give it the toggle + providers.
const SYMBOLS_BY_LANGUAGE: Partial<Record<Language, LangSymbol[]>> = {
  c: C_SYMBOLS,
  cpp: [...C_SYMBOLS, ...CPP_EXTRA_SYMBOLS],
  python: PYTHON_SYMBOLS,
  java: JAVA_SYMBOLS
  // wave 2: go, rust  |  wave 4: javascript (gate the built-in TS worker)
};

/** Whether a static stdlib symbol table exists for this language. */
export function languageHasSuggestions(language: Language): boolean {
  return SYMBOLS_BY_LANGUAGE[language] !== undefined;
}

/**
 * Register static standard-library completion + signature help providers for the
 * given language. Returns a disposable that tears down every registered provider —
 * call it when the advanced-suggestions switch turns off or the language changes.
 * Returns null when the language has no static table.
 */
export function registerSuggestions(monaco: Monaco, language: Language): IDisposable | null {
  const symbols = SYMBOLS_BY_LANGUAGE[language];
  if (!symbols) return null;
  const disposables = registerForLanguage(monaco, language, symbols);
  return {
    dispose() {
      for (const d of disposables) d.dispose();
    }
  };
}

// Exposed for tests.
export const __test = { C_SYMBOLS, CPP_EXTRA_SYMBOLS, PYTHON_SYMBOLS, JAVA_SYMBOLS, fnSnippet };
