import { z } from "zod";

export const LANGUAGES = ["c", "cpp", "python", "javascript", "java", "go", "rust"] as const;
export type Language = (typeof LANGUAGES)[number];

export const MAX_SOURCE_BYTES = 200_000;
export const MAX_STDIN_BYTES = 1_000_000;
export const MAX_ARG_COUNT = 32;
export const MAX_ARG_BYTES = 256;
export const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;
export const MAX_FILES = 20;
export const MAX_TOTAL_SOURCE_BYTES = 2_000_000;
/**
 * Max raw HTTP body (JSON) accepted for /run + /debug. Must comfortably cover
 * MAX_TOTAL_SOURCE_BYTES + MAX_STDIN_BYTES + argv plus JSON-escaping headroom,
 * otherwise the transport rejects (413) a payload the schema would allow.
 */
export const MAX_REQUEST_BODY_BYTES = 8 * 1024 * 1024;

export const LanguageSchema = z.enum(LANGUAGES);

/** File extensions accepted per language for multi-file projects. */
export const LANGUAGE_EXTENSIONS: Record<Language, readonly string[]> = {
  c: [".c", ".h"],
  cpp: [".cpp", ".cc", ".hpp", ".hh", ".h"],
  python: [".py"],
  javascript: [".js", ".mjs"],
  java: [".java"],
  go: [".go"],
  rust: [".rs"]
};

/** Workspace files the runner writes itself — user files must not collide. */
export const RESERVED_FILENAMES = [
  "stdin.txt",
  "program.out",
  "__debugpy_runner.py",
  "scratch.txt",
  ".gdbinit"
];

export const FILENAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

/** Lowercased extension incl. leading dot (e.g. ".c"); "" for none/dotfile. */
export function fileExtension(path: string): string {
  const dot = path.lastIndexOf(".");
  if (dot <= 0) {
    return "";
  }
  return path.slice(dot).toLowerCase();
}

/** Default first-file name for a language (entry by linker-resolved main()). */
export function defaultFileName(language: Language): string {
  if (language === "c") {
    return "main.c";
  }
  if (language === "cpp") {
    return "main.cpp";
  }
  if (language === "javascript") {
    return "main.js";
  }
  if (language === "java") {
    return "Main.java";
  }
  if (language === "go") {
    return "main.go";
  }
  if (language === "rust") {
    return "main.rs";
  }
  return "main.py";
}

export const ProjectFileSchema = z.object({
  path: z.string().min(1).max(64),
  content: z.string().max(MAX_SOURCE_BYTES)
});
export type ProjectFile = z.infer<typeof ProjectFileSchema>;

export const BreakpointSchema = z.object({
  path: z.string().min(1).max(64),
  line: z.number().int().positive()
});
export type Breakpoint = z.infer<typeof BreakpointSchema>;

function refineProjectFiles(
  value: { language: Language; files: ProjectFile[] },
  ctx: z.RefinementCtx
): void {
  const allowed = LANGUAGE_EXTENSIONS[value.language];
  const seen = new Set<string>();
  let total = 0;

  value.files.forEach((file, index) => {
    total += file.content.length;
    const issue = (message: string): void => {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["files", index, "path"], message });
    };

    if (!FILENAME_PATTERN.test(file.path) || file.path.startsWith(".")) {
      issue(`Invalid file name "${file.path}" (use letters, digits, ., _, -; no leading dot)`);
      return;
    }
    if (RESERVED_FILENAMES.includes(file.path.toLowerCase())) {
      issue(`"${file.path}" is a reserved file name`);
    }
    const ext = fileExtension(file.path);
    if (!allowed.includes(ext)) {
      issue(`Extension "${ext || "(none)"}" not allowed for ${value.language} (allowed: ${allowed.join(", ")})`);
    }
    const lower = file.path.toLowerCase();
    if (seen.has(lower)) {
      issue(`Duplicate file name "${file.path}"`);
    }
    seen.add(lower);
  });

  if (total > MAX_TOTAL_SOURCE_BYTES) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["files"],
      message: `Total source size ${total} exceeds ${MAX_TOTAL_SOURCE_BYTES} characters`
    });
  }
}

/**
 * Reject a `toolchainVersion` that the requested language does not advertise.
 * Omitted is always fine — the runner falls back to the capability's default
 * (see `resolveToolchainVersion`). A version on a language with no `versions`
 * list is rejected so a typo cannot silently pick the wrong toolchain.
 */
function refineToolchainVersion(
  value: { language: Language; toolchainVersion?: string },
  ctx: z.RefinementCtx
): void {
  if (value.toolchainVersion === undefined) {
    return;
  }
  const versions = LANGUAGE_CAPABILITIES.find((cap) => cap.id === value.language)?.versions;
  if (!versions?.includes(value.toolchainVersion)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["toolchainVersion"],
      message: `Unsupported version "${value.toolchainVersion}" for ${value.language}`
    });
  }
}

const RunRequestBaseSchema = z.object({
  language: LanguageSchema,
  files: z.array(ProjectFileSchema).min(1).max(MAX_FILES),
  stdin: z.string().max(MAX_STDIN_BYTES).default(""),
  argv: z.array(z.string().max(MAX_ARG_BYTES)).max(MAX_ARG_COUNT).default([]),
  /** Optional toolchain version (e.g. Java "17"/"21"/"25"). Omitted ⇒ default. */
  toolchainVersion: z.string().max(16).optional()
});

function refineRunRequest(
  value: { language: Language; files: ProjectFile[]; toolchainVersion?: string },
  ctx: z.RefinementCtx
): void {
  refineProjectFiles(value, ctx);
  refineToolchainVersion(value, ctx);
}

export const RunRequestSchema = RunRequestBaseSchema.superRefine(refineRunRequest);

export const DebugRequestSchema = RunRequestBaseSchema.extend({
  breakpoints: z.array(BreakpointSchema).max(100).default([]),
  clientId: z.string().min(1).max(128)
}).superRefine(refineRunRequest);

export const DebugCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("continue") }),
  z.object({ type: z.literal("pause") }),
  z.object({ type: z.literal("stepOver") }),
  z.object({ type: z.literal("stepInto") }),
  z.object({ type: z.literal("stepOut") }),
  z.object({ type: z.literal("stop") }),
  z.object({
    type: z.literal("setBreakpoints"),
    breakpoints: z.array(BreakpointSchema).max(100)
  }),
  z.object({ type: z.literal("variables") }),
  z.object({ type: z.literal("stack") }),
  z.object({
    type: z.literal("evaluate"),
    expression: z.string().min(1).max(512)
  }),
  z.object({
    type: z.literal("removeWatch"),
    expression: z.string().min(1).max(512)
  }),
  z.object({
    type: z.literal("expand"),
    variablesReference: z.number().int().positive()
  }),
  z.object({
    type: z.literal("raw"),
    command: z.string().min(1).max(1_000)
  })
]);

export type RunRequest = z.infer<typeof RunRequestSchema>;
export type DebugRequest = z.infer<typeof DebugRequestSchema>;
export type DebugCommand = z.infer<typeof DebugCommandSchema>;

export type LanguageCapability = {
  id: Language;
  label: string;
  run: boolean;
  debug: boolean;
  defaultSource: string;
  /** Selectable toolchain versions (e.g. Java JDKs). Absent ⇒ no version picker. */
  versions?: readonly string[];
  /** Default version when the request omits `toolchainVersion`. */
  defaultVersion?: string;
};

/**
 * Effective toolchain version for a run/debug request: the requested one if the
 * language advertises it, otherwise the capability's default (or first listed).
 * Returns `undefined` for languages without a `versions` list. Single source of
 * truth so the runner does not re-implement the fallback rule.
 */
export function resolveToolchainVersion(language: Language, requested?: string): string | undefined {
  const cap = LANGUAGE_CAPABILITIES.find((item) => item.id === language);
  if (!cap?.versions?.length) {
    return undefined;
  }
  if (requested && cap.versions.includes(requested)) {
    return requested;
  }
  return cap.defaultVersion ?? cap.versions[0];
}

export type HealthResponse = {
  ok: boolean;
  runner: boolean;
};

export type JobCreateResponse = {
  id: string;
};

export type RunEvent =
  | { type: "ready"; id: string }
  | { type: "compile"; status: "start" | "done" }
  | { type: "run"; status: "start" }
  | { type: "metric"; phase: "run"; cpuMs: number; cpuScope: "user-code" | "process"; memoryBytes: number }
  | { type: "stdout"; data: string }
  | { type: "stderr"; data: string }
  | { type: "exit"; code: number | null; signal?: string | null; timedOut: boolean; outputTruncated: boolean; cancelled?: boolean }
  | { type: "error"; message: string };

export type DebugFrame = {
  level: number;
  func: string;
  file?: string;
  line?: number;
};

export type DebugVariable = {
  name: string;
  value?: string;
  variablesReference?: number;
};

export type DebugEvent =
  | { type: "ready"; id: string }
  | { type: "compile"; status: "start" | "done" }
  | { type: "stdout"; data: string }
  | { type: "stderr"; data: string }
  | { type: "console"; data: string }
  | { type: "mi"; data: string }
  | { type: "stopped"; reason?: string; file?: string; line?: number; func?: string }
  | { type: "running" }
  | { type: "variables"; variables: DebugVariable[] }
  | { type: "variableChildren"; variablesReference: number; variables: DebugVariable[] }
  | { type: "stack"; frames: DebugFrame[] }
  | { type: "watch"; expression: string; value?: string; error?: string }
  | { type: "exit"; code: number | null; signal?: string | null; timedOut: boolean }
  | { type: "error"; message: string };

export const LANGUAGE_CAPABILITIES: LanguageCapability[] = [
  {
    id: "c",
    label: "C",
    run: true,
    debug: true,
    defaultSource: [
      "#include <stdio.h>",
      "",
      "int main() {",
      "    printf(\"Hello World\\n\");",
      "    return 0;",
      "}"
    ].join("\n")
  },
  {
    id: "cpp",
    label: "C++",
    run: true,
    debug: true,
    defaultSource: [
      "#include <iostream>",
      "using namespace std;",
      "",
      "int main() {",
      "    cout << \"Hello World\" << endl;",
      "    return 0;",
      "}"
    ].join("\n")
  },
  {
    id: "python",
    label: "Python",
    run: true,
    debug: true,
    defaultSource: "print(\"Hello World\")"
  },
  {
    id: "javascript",
    label: "JavaScript",
    run: true,
    debug: false,
    defaultSource: "console.log(\"Hello World\");"
  },
  {
    id: "java",
    label: "Java",
    run: true,
    debug: false,
    versions: ["17", "21", "25"],
    defaultVersion: "21",
    defaultSource: [
      "public class Main {",
      "    public static void main(String[] args) {",
      "        System.out.println(\"Hello World\");",
      "    }",
      "}"
    ].join("\n")
  },
  {
    id: "go",
    label: "Go",
    run: true,
    debug: true,
    defaultSource: [
      "package main",
      "",
      "import \"fmt\"",
      "",
      "func main() {",
      "\tfmt.Println(\"Hello World\")",
      "}"
    ].join("\n")
  },
  {
    id: "rust",
    label: "Rust",
    run: true,
    debug: true,
    defaultSource: [
      "fn main() {",
      "    println!(\"Hello World\");",
      "}"
    ].join("\n")
  }
];

// ---------------------------------------------------------------------------
// User accounts + per-user file explorer (Phase 2)
//
// App-managed accounts (no Linux/PAM): each user owns a directory tree under the
// server's USER_HOMES_ROOT. Unlike the run/debug protocol (a flat file list),
// the explorer supports nested folders, so paths here use "/" separators. The
// segment charset mirrors FILENAME_PATTERN (no leading dot) so every saved file
// is still a valid run-protocol file name when gathered into a run request.
// ---------------------------------------------------------------------------

/** Account name; doubles as the on-disk directory name for the user's home. */
export const USERNAME_PATTERN = /^[a-z][a-z0-9_-]{2,31}$/;
/** One path segment (file or folder name). No leading dot, no "/" or "..". */
export const USER_PATH_SEGMENT_PATTERN = /^(?!\.)[A-Za-z0-9._-]{1,64}$/;

export const MAX_USER_FILE_BYTES = MAX_SOURCE_BYTES;
export const MAX_TREE_ENTRIES = 500;
export const MAX_TREE_DEPTH = 8;
export const MAX_USER_PATH_SEGMENTS = MAX_TREE_DEPTH;
export const MAX_USER_PATH_CHARS = 512;

/**
 * Validate a relative user path and return its segments, or null if invalid.
 * Pure shape check (charset, segment count, length) — server-side path-safety
 * (resolve + prefix assert + symlink rejection) lives in apps/api/pathSafety.ts.
 */
export function parseUserPath(path: string): string[] | null {
  if (typeof path !== "string" || path.length === 0 || path.length > MAX_USER_PATH_CHARS) {
    return null;
  }
  const segments = path.split("/");
  if (segments.length < 1 || segments.length > MAX_USER_PATH_SEGMENTS) {
    return null;
  }
  for (const segment of segments) {
    if (!USER_PATH_SEGMENT_PATTERN.test(segment)) {
      return null;
    }
  }
  return segments;
}

export const UserPathSchema = z
  .string()
  .min(1)
  .max(MAX_USER_PATH_CHARS)
  .refine((value) => parseUserPath(value) !== null, {
    message: "Invalid path (use letters, digits, ., _, -, / separators; no leading dot, no ..)"
  });

export const UsernameSchema = z.string().regex(USERNAME_PATTERN, {
  message: "Invalid username (3-32 chars, lowercase letter first, then a-z 0-9 _ -)"
});

export const LoginRequestSchema = z.object({
  username: UsernameSchema,
  password: z.string().min(1).max(256)
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const WriteFileRequestSchema = z.object({
  path: UserPathSchema,
  content: z.string().max(MAX_USER_FILE_BYTES)
});
export type WriteFileRequest = z.infer<typeof WriteFileRequestSchema>;

export const MkdirRequestSchema = z.object({
  path: UserPathSchema
});
export type MkdirRequest = z.infer<typeof MkdirRequestSchema>;

export const RenameRequestSchema = z.object({
  path: UserPathSchema,
  newName: z.string().regex(USER_PATH_SEGMENT_PATTERN, {
    message: "Invalid name (letters, digits, ., _, -; no leading dot, no slashes)"
  })
});
export type RenameRequest = z.infer<typeof RenameRequestSchema>;

export type TreeNode = {
  name: string;
  path: string;
  type: "dir" | "file";
  size?: number;
  children?: TreeNode[];
};

export type TreeResponse = {
  username: string;
  entries: TreeNode[];
};

export type FileResponse = {
  path: string;
  content: string;
  size: number;
  mtimeMs: number;
};

/** Top-level regular files of one folder, with content — feeds run-the-folder. */
export type FolderFilesResponse = {
  path: string;
  files: { name: string; content: string; size: number }[];
};

export type AuthMeResponse = {
  username: string;
};

export function parseArgv(input: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: "\"" | "'" | null = null;
  let escaping = false;

  for (const char of input) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === "\\") {
      escaping = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        args.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (escaping) {
    current += "\\";
  }

  if (quote) {
    throw new Error("Unclosed quote in arguments");
  }

  if (current.length > 0) {
    args.push(current);
  }

  return args;
}
