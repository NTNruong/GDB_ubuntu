import { z } from "zod";

export const LANGUAGES = ["c", "cpp", "python"] as const;
export type Language = (typeof LANGUAGES)[number];

export const MAX_SOURCE_BYTES = 200_000;
export const MAX_STDIN_BYTES = 1_000_000;
export const MAX_ARG_COUNT = 32;
export const MAX_ARG_BYTES = 256;
export const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;
export const MAX_FILES = 20;
export const MAX_TOTAL_SOURCE_BYTES = 2_000_000;

export const LanguageSchema = z.enum(LANGUAGES);

/** File extensions accepted per language for multi-file projects. */
export const LANGUAGE_EXTENSIONS: Record<Language, readonly string[]> = {
  c: [".c", ".h"],
  cpp: [".cpp", ".cc", ".hpp", ".hh", ".h"],
  python: [".py"]
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

const RunRequestBaseSchema = z.object({
  language: LanguageSchema,
  files: z.array(ProjectFileSchema).min(1).max(MAX_FILES),
  stdin: z.string().max(MAX_STDIN_BYTES).default(""),
  argv: z.array(z.string().max(MAX_ARG_BYTES)).max(MAX_ARG_COUNT).default([])
});

export const RunRequestSchema = RunRequestBaseSchema.superRefine(refineProjectFiles);

export const DebugRequestSchema = RunRequestBaseSchema.extend({
  breakpoints: z.array(BreakpointSchema).max(100).default([]),
  clientId: z.string().min(1).max(128)
}).superRefine(refineProjectFiles);

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
};

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
  | { type: "metric"; phase: "run"; elapsedMs: number; memoryBytes: number }
  | { type: "stdout"; data: string }
  | { type: "stderr"; data: string }
  | { type: "exit"; code: number | null; signal?: string | null; timedOut: boolean; outputTruncated: boolean }
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
  }
];

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
