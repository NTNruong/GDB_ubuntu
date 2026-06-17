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

// --- Go standard library ---------------------------------------------------
// Package members use BARE labels (e.g. `Println`, not `fmt.Println`) so they complete
// after the user types the package + dot — Monaco's word range splits on `.`. Builtins
// (`len`, `make`, ...) are unqualified. Labels must be UNIQUE (provider has no dedup).
const GO_SYMBOLS: LangSymbol[] = [
  // fmt
  fn("Println", "func fmt.Println(a ...any) (n int, err error)", ["a ...any"], "Print with spaces and a newline."),
  fn("Printf", "func fmt.Printf(format string, a ...any) (n int, err error)", ["format string", "a ...any"]),
  fn("Print", "func fmt.Print(a ...any) (n int, err error)", ["a ...any"]),
  fn("Sprintf", "func fmt.Sprintf(format string, a ...any) string", ["format string", "a ...any"]),
  fn("Sprint", "func fmt.Sprint(a ...any) string", ["a ...any"]),
  fn("Sprintln", "func fmt.Sprintln(a ...any) string", ["a ...any"]),
  fn("Scanln", "func fmt.Scanln(a ...any) (n int, err error)", ["a ...any"]),
  fn("Scan", "func fmt.Scan(a ...any) (n int, err error)", ["a ...any"]),
  fn("Scanf", "func fmt.Scanf(format string, a ...any) (n int, err error)", ["format string", "a ...any"]),
  fn("Errorf", "func fmt.Errorf(format string, a ...any) error", ["format string", "a ...any"]),
  fn("Fprintln", "func fmt.Fprintln(w io.Writer, a ...any) (n int, err error)", ["w io.Writer", "a ...any"]),
  // strings
  fn("Split", "func strings.Split(s, sep string) []string", ["s string", "sep string"]),
  fn("Join", "func strings.Join(elems []string, sep string) string", ["elems []string", "sep string"]),
  fn("Contains", "func strings.Contains(s, substr string) bool", ["s string", "substr string"]),
  fn("HasPrefix", "func strings.HasPrefix(s, prefix string) bool", ["s string", "prefix string"]),
  fn("HasSuffix", "func strings.HasSuffix(s, suffix string) bool", ["s string", "suffix string"]),
  fn("ToUpper", "func strings.ToUpper(s string) string", ["s string"]),
  fn("ToLower", "func strings.ToLower(s string) string", ["s string"]),
  fn("TrimSpace", "func strings.TrimSpace(s string) string", ["s string"]),
  fn("ReplaceAll", "func strings.ReplaceAll(s, old, new string) string", ["s string", "old string", "new string"]),
  fn("Index", "func strings.Index(s, substr string) int", ["s string", "substr string"]),
  fn("Repeat", "func strings.Repeat(s string, count int) string", ["s string", "count int"]),
  fn("Fields", "func strings.Fields(s string) []string", ["s string"]),
  // strconv
  fn("Atoi", "func strconv.Atoi(s string) (int, error)", ["s string"]),
  fn("Itoa", "func strconv.Itoa(i int) string", ["i int"]),
  fn("ParseInt", "func strconv.ParseInt(s string, base, bitSize int) (int64, error)", ["s string", "base int", "bitSize int"]),
  fn("ParseFloat", "func strconv.ParseFloat(s string, bitSize int) (float64, error)", ["s string", "bitSize int"]),
  fn("FormatInt", "func strconv.FormatInt(i int64, base int) string", ["i int64", "base int"]),
  // os
  fn("Exit", "func os.Exit(code int)", ["code int"]),
  fn("Open", "func os.Open(name string) (*os.File, error)", ["name string"]),
  fn("Create", "func os.Create(name string) (*os.File, error)", ["name string"]),
  fn("Getenv", "func os.Getenv(key string) string", ["key string"]),
  // math
  fn("Abs", "func math.Abs(x float64) float64", ["x float64"]),
  fn("Max", "func math.Max(x, y float64) float64", ["x float64", "y float64"]),
  fn("Min", "func math.Min(x, y float64) float64", ["x float64", "y float64"]),
  fn("Sqrt", "func math.Sqrt(x float64) float64", ["x float64"]),
  fn("Pow", "func math.Pow(x, y float64) float64", ["x float64", "y float64"]),
  fn("Floor", "func math.Floor(x float64) float64", ["x float64"]),
  fn("Ceil", "func math.Ceil(x float64) float64", ["x float64"]),
  fn("Round", "func math.Round(x float64) float64", ["x float64"]),
  // sort
  fn("Ints", "func sort.Ints(a []int)", ["a []int"]),
  fn("Strings", "func sort.Strings(a []string)", ["a []string"]),
  fn("Float64s", "func sort.Float64s(a []float64)", ["a []float64"]),
  fn("Slice", "func sort.Slice(slice any, less func(i, j int) bool)", ["slice any", "less func(i, j int) bool"]),
  // bufio
  fn("NewReader", "func bufio.NewReader(rd io.Reader) *bufio.Reader", ["rd io.Reader"]),
  fn("NewScanner", "func bufio.NewScanner(r io.Reader) *bufio.Scanner", ["r io.Reader"]),
  fn("NewWriter", "func bufio.NewWriter(w io.Writer) *bufio.Writer", ["w io.Writer"]),
  // builtins (unqualified)
  fn("len", "builtin len(v Type) int", ["v"]),
  fn("cap", "builtin cap(v Type) int", ["v"]),
  fn("make", "builtin make(t Type, size ...int) Type", ["t Type", "size ...int"]),
  fn("new", "builtin new(Type) *Type", ["Type"]),
  fn("append", "builtin append(slice []Type, elems ...Type) []Type", ["slice []Type", "elems ...Type"]),
  fn("copy", "builtin copy(dst, src []Type) int", ["dst []Type", "src []Type"]),
  fn("delete", "builtin delete(m map[Type]Type1, key Type)", ["m map", "key"]),
  fn("panic", "builtin panic(v any)", ["v any"]),
  fn("recover", "builtin recover() any", []),
  fn("close", "builtin close(c chan<- Type)", ["c chan"]),
  // members / static fields (bare)
  ct("Args", "os.Args"), ct("Stdin", "os.Stdin"), ct("Stdout", "os.Stdout"), ct("Stderr", "os.Stderr"),
  ct("Pi", "math.Pi"), ct("MaxInt", "math.MaxInt"),
  // types
  ty("string"), ty("int"), ty("int64"), ty("float64"), ty("bool"), ty("byte"), ty("rune"),
  ty("error"), ty("any"), ty("map"), ty("chan"), ty("struct"), ty("interface"),
  ty("Reader"), ty("Writer"), ty("Builder"), ty("WaitGroup"),
  // constants
  ct("true"), ct("false"), ct("nil"), ct("iota"),
  // live-template abbreviations (dot-free)
  snip("iferr", "if err != nil {\n\t${1}\n}", "if err != nil { ... }"),
  snip("forr", "for ${1:i}, ${2:v} := range ${3:items} {\n\t${4}\n}", "for ... range"),
  snip("funcmain", "func main() {\n\t${1}\n}", "func main"),
  // keywords
  ...["func", "var", "const", "type", "package", "import", "return", "if", "else", "for",
    "range", "switch", "case", "default", "break", "continue", "go", "defer", "select",
    "fallthrough", "goto"].map(kw)
];

// --- Rust standard library -------------------------------------------------
// Methods/associated fns use BARE labels (`push`, `new`) so they complete after `.` or
// `::` (Monaco splits the word on both). Macros keep their `!` in the label. Labels must
// be UNIQUE (provider has no dedup).
const RUST_SYMBOLS: LangSymbol[] = [
  // macros (label keeps the `!`; identifierBefore now captures the bang for signature help)
  fn("println!", "macro println!(fmt: &str, args: ...)", ['"{}"', "value"], "Print with a trailing newline."),
  fn("print!", "macro print!(fmt: &str, args: ...)", ['"{}"', "value"]),
  fn("eprintln!", "macro eprintln!(fmt: &str, args: ...)", ['"{}"', "value"]),
  fn("format!", "macro format!(fmt: &str, args: ...) -> String", ['"{}"', "value"]),
  fn("vec!", "macro vec![elem; n] / vec![a, b, c]", ["elems"]),
  fn("panic!", "macro panic!(fmt: &str, args: ...)", ['"{}"', "value"]),
  fn("assert!", "macro assert!(cond, fmt?, args?)", ["cond"]),
  fn("assert_eq!", "macro assert_eq!(left, right)", ["left", "right"]),
  fn("write!", "macro write!(dst, fmt: &str, args: ...)", ["dst", '"{}"', "value"]),
  fn("writeln!", "macro writeln!(dst, fmt: &str, args: ...)", ["dst", '"{}"', "value"]),
  fn("dbg!", "macro dbg!(expr)", ["expr"]),
  fn("todo!", "macro todo!()", []),
  // methods / associated functions (bare)
  fn("len", "fn len(&self) -> usize", []),
  fn("push", "fn push(&mut self, value: T)", ["value: T"]),
  fn("pop", "fn pop(&mut self) -> Option<T>", []),
  fn("insert", "fn insert(&mut self, index: usize, element: T)", ["index: usize", "element: T"]),
  fn("remove", "fn remove(&mut self, index: usize) -> T", ["index: usize"]),
  fn("get", "fn get(&self, index: usize) -> Option<&T>", ["index: usize"]),
  fn("iter", "fn iter(&self) -> Iter<T>", []),
  fn("into_iter", "fn into_iter(self) -> IntoIter<T>", []),
  fn("collect", "fn collect<B>(self) -> B", []),
  fn("map", "fn map<B, F>(self, f: F) -> Map<Self, F>", ["f"]),
  fn("filter", "fn filter<P>(self, predicate: P) -> Filter<Self, P>", ["predicate"]),
  fn("unwrap", "fn unwrap(self) -> T", []),
  fn("unwrap_or", "fn unwrap_or(self, default: T) -> T", ["default: T"]),
  fn("expect", "fn expect(self, msg: &str) -> T", ["msg: &str"]),
  fn("clone", "fn clone(&self) -> Self", []),
  fn("to_string", "fn to_string(&self) -> String", []),
  fn("as_str", "fn as_str(&self) -> &str", []),
  fn("parse", "fn parse<F>(&self) -> Result<F, F::Err>", []),
  fn("contains", "fn contains(&self, x: &T) -> bool", ["x: &T"]),
  fn("is_empty", "fn is_empty(&self) -> bool", []),
  fn("trim", "fn trim(&self) -> &str", []),
  fn("split", "fn split<P>(&self, pat: P) -> Split<P>", ["pat: P"]),
  fn("chars", "fn chars(&self) -> Chars", []),
  fn("next", "fn next(&mut self) -> Option<Item>", []),
  fn("sum", "fn sum<S>(self) -> S", []),
  fn("sort", "fn sort(&mut self)", []),
  fn("enumerate", "fn enumerate(self) -> Enumerate<Self>", []),
  fn("zip", "fn zip<U>(self, other: U) -> Zip<Self, U>", ["other: U"]),
  fn("read_line", "fn read_line(&self, buf: &mut String) -> io::Result<usize>", ["buf: &mut String"]),
  fn("new", "fn new() -> Self", []),
  fn("with_capacity", "fn with_capacity(capacity: usize) -> Self", ["capacity: usize"]),
  fn("from", "fn from(value: T) -> Self", ["value: T"]),
  fn("as_bytes", "fn as_bytes(&self) -> &[u8]", []),
  fn("starts_with", "fn starts_with<P>(&self, pat: P) -> bool", ["pat: P"]),
  fn("ends_with", "fn ends_with<P>(&self, pat: P) -> bool", ["pat: P"]),
  fn("replace", "fn replace<P>(&self, from: P, to: &str) -> String", ["from: P", "to: &str"]),
  fn("to_uppercase", "fn to_uppercase(&self) -> String", []),
  fn("to_lowercase", "fn to_lowercase(&self) -> String", []),
  // enum-variant constructors
  fn("Some", "Some(value: T) -> Option<T>", ["value: T"]),
  fn("Ok", "Ok(value: T) -> Result<T, E>", ["value: T"]),
  fn("Err", "Err(error: E) -> Result<T, E>", ["error: E"]),
  ct("None", "Option::None"),
  // types
  ty("String"), ty("Vec"), ty("Option"), ty("Result"), ty("Box"), ty("HashMap"), ty("HashSet"),
  ty("BTreeMap"), ty("Rc"), ty("Arc"), ty("RefCell"), ty("str"), ty("i32"), ty("i64"),
  ty("u32"), ty("u64"), ty("usize"), ty("f64"), ty("bool"), ty("char"),
  // live-template abbreviations (dot-free)
  snip("fnmain", "fn main() {\n\t${1}\n}", "fn main"),
  snip("forr", "for ${1:item} in ${2:iter} {\n\t${3}\n}", "for ... in"),
  // keywords
  ...["fn", "let", "mut", "const", "static", "struct", "enum", "trait", "impl", "pub", "use",
    "mod", "match", "if", "else", "for", "while", "loop", "return", "break", "continue",
    "where", "as", "ref", "move", "dyn", "async", "await", "unsafe", "self", "crate",
    "super", "in"].map(kw)
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
  const end = j + 1; // exclusive end, after an optional Rust macro `!`
  if (j >= 0 && text[j] === "!") j--; // include the bang so `println!(` resolves to `println!`
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
  java: JAVA_SYMBOLS,
  go: GO_SYMBOLS,
  rust: RUST_SYMBOLS
  // wave 4: javascript (gate the built-in TS worker)
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
export const __test = { C_SYMBOLS, CPP_EXTRA_SYMBOLS, PYTHON_SYMBOLS, JAVA_SYMBOLS, GO_SYMBOLS, RUST_SYMBOLS, fnSnippet };
