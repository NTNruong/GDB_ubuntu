import { z } from "zod";

export const LANGUAGES = ["c", "cpp", "python"] as const;
export type Language = (typeof LANGUAGES)[number];

export const MAX_SOURCE_BYTES = 200_000;
export const MAX_STDIN_BYTES = 1_000_000;
export const MAX_ARG_COUNT = 32;
export const MAX_ARG_BYTES = 256;
export const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;

export const LanguageSchema = z.enum(LANGUAGES);

export const RunRequestSchema = z.object({
  language: LanguageSchema,
  source: z.string().min(1).max(MAX_SOURCE_BYTES),
  stdin: z.string().max(MAX_STDIN_BYTES).default(""),
  argv: z.array(z.string().max(MAX_ARG_BYTES)).max(MAX_ARG_COUNT).default([])
});

export const DebugRequestSchema = RunRequestSchema.extend({
  language: z.enum(["c", "cpp", "python"]),
  breakpoints: z.array(z.number().int().positive()).max(100).default([]),
  clientId: z.string().min(1).max(128)
});

export const DebugCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("continue") }),
  z.object({ type: z.literal("pause") }),
  z.object({ type: z.literal("stepOver") }),
  z.object({ type: z.literal("stepInto") }),
  z.object({ type: z.literal("stepOut") }),
  z.object({ type: z.literal("stop") }),
  z.object({
    type: z.literal("setBreakpoints"),
    breakpoints: z.array(z.number().int().positive()).max(100)
  }),
  z.object({ type: z.literal("variables") }),
  z.object({ type: z.literal("stack") }),
  z.object({
    type: z.literal("evaluate"),
    expression: z.string().min(1).max(512)
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
