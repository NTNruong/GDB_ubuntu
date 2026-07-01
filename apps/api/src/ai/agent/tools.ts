import { readFile, writeFile } from "node:fs/promises";
import type { FastifyBaseLogger } from "fastify";
import type { AiAgentStep, TreeNode } from "@internal/shared";
import { PathError, assertSafePath, walkTree } from "../../pathSafety.js";
import type { Embedder } from "../../rag/embedding.js";
import { formatDocContext, searchDocs } from "../../rag/search.js";
import type { VectorStore } from "../../rag/store.js";
import type { ToolDeclaration } from "../backends/geminiTools.js";

/** Files the tutor maintains in the learner's home (visible + editable in the Explorer). */
export const STUDY_PLAN_FILE = "STUDY_PLAN.md";
export const MEMORY_FILE = "MEMORY.md";

/** Cap read_file output so a big file can't blow the model's context / quota. */
const MAX_READ_BYTES = 40_000;

/** Everything a tool needs: the jailed home + (optional) RAG retrieval + a logger. */
export type AgentContext = {
  userHome: string;
  store: VectorStore | null;
  embedder: Embedder | null;
  log: FastifyBaseLogger;
};

/** A tool's outcome: text fed back to the model, plus an optional UI step to emit. */
export type ToolResult = { result: string; step?: AiAgentStep };

type ToolHandler = (args: Record<string, unknown>, ctx: AgentContext) => Promise<ToolResult>;
type Tool = { declaration: ToolDeclaration; run: ToolHandler };

function str(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string") {
    throw new PathError(`Tool argument "${key}" must be a string`, 400);
  }
  return value;
}

function int(args: Record<string, unknown>, key: string): number {
  const value = args[key];
  const num = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(num)) {
    throw new PathError(`Tool argument "${key}" must be a number`, 400);
  }
  return Math.trunc(num);
}

function flatten(nodes: TreeNode[], out: string[]): void {
  for (const node of nodes) {
    out.push(node.type === "dir" ? `${node.path}/` : node.path);
    if (node.type === "dir" && node.children) {
      flatten(node.children, out);
    }
  }
}

async function readMemory(userHome: string): Promise<string> {
  const abs = await assertSafePath(userHome, MEMORY_FILE);
  try {
    return await readFile(abs, "utf8");
  } catch {
    return "";
  }
}

const TOOLS: Tool[] = [
  {
    declaration: {
      name: "search_docs",
      description:
        "Search the authoritative programming/embedded documentation corpus (CMSIS, ESP-IDF, STM32, FreeRTOS, Zephyr, …). Use this before answering doc or embedded questions; cite the returned sources.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Natural-language search query" } },
        required: ["query"]
      }
    },
    run: async (args, ctx) => {
      const query = str(args, "query");
      if (!ctx.store || !ctx.embedder) {
        return { result: "Documentation search is unavailable (no index or API key)." };
      }
      const hits = await searchDocs(ctx.store, ctx.embedder, query);
      if (hits.length === 0) {
        return { result: "No relevant documentation found." };
      }
      return { result: formatDocContext(hits) };
    }
  },
  {
    declaration: {
      name: "read_file",
      description:
        "Read a file from the learner's workspace by relative path. Output is prefixed with 1-based line numbers so you can reference exact lines in propose_edit.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Path relative to the workspace root" } },
        required: ["path"]
      }
    },
    run: async (args, ctx) => {
      const rel = str(args, "path");
      const abs = await assertSafePath(ctx.userHome, rel);
      let content = await readFile(abs, "utf8");
      let truncated = false;
      if (content.length > MAX_READ_BYTES) {
        content = content.slice(0, MAX_READ_BYTES);
        truncated = true;
      }
      const numbered = content
        .split("\n")
        .map((line, index) => `${index + 1}\t${line}`)
        .join("\n");
      return { result: truncated ? `${numbered}\n… (truncated)` : numbered };
    }
  },
  {
    declaration: {
      name: "list_dir",
      description: "List the files and folders in the learner's workspace (relative paths).",
      parameters: { type: "object", properties: {}, required: [] }
    },
    run: async (_args, ctx) => {
      const tree = await walkTree(ctx.userHome);
      const out: string[] = [];
      flatten(tree, out);
      return { result: out.length > 0 ? out.join("\n") : "(empty workspace)" };
    }
  },
  {
    declaration: {
      name: "propose_edit",
      description:
        "Propose an edit to the learner's code as a diff they review and Apply (never edit silently). Give the 1-based line range to replace (inclusive) and the replacement text. Read the file first so the range is correct.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          startLine: { type: "integer", description: "First line to replace (1-based, inclusive)" },
          endLine: { type: "integer", description: "Last line to replace (1-based, inclusive)" },
          replacement: { type: "string", description: "New text for that line range" },
          note: { type: "string", description: "Short explanation of the change" }
        },
        required: ["path", "startLine", "endLine", "replacement"]
      }
    },
    run: async (args, ctx) => {
      const rel = str(args, "path");
      await assertSafePath(ctx.userHome, rel); // validate only — no write
      const startLine = int(args, "startLine");
      const endLine = int(args, "endLine");
      const replacement = str(args, "replacement");
      const note = typeof args.note === "string" ? args.note : undefined;
      return {
        result: `Proposed an edit to ${rel} lines ${startLine}-${endLine}. Waiting for the learner to Apply it.`,
        step: { kind: "proposed_edit", path: rel, startLine, endLine, replacement, ...(note ? { note } : {}) }
      };
    }
  },
  {
    declaration: {
      name: "write_study_plan",
      description:
        "Create or overwrite STUDY_PLAN.md in the learner's home with a milestone-based learning roadmap (Markdown). Order milestones by dependency, not by date.",
      parameters: {
        type: "object",
        properties: { markdown: { type: "string", description: "The full STUDY_PLAN.md content" } },
        required: ["markdown"]
      }
    },
    run: async (args, ctx) => {
      const markdown = str(args, "markdown");
      const abs = await assertSafePath(ctx.userHome, STUDY_PLAN_FILE);
      await writeFile(abs, markdown, { mode: 0o600 });
      return { result: `Wrote ${STUDY_PLAN_FILE} (${markdown.length} chars).` };
    }
  },
  {
    declaration: {
      name: "read_memory",
      description: "Read the learner's MEMORY.md — milestone-based progress notes carried across sessions.",
      parameters: { type: "object", properties: {}, required: [] }
    },
    run: async (_args, ctx) => {
      const memory = await readMemory(ctx.userHome);
      return { result: memory || "(MEMORY.md is empty)" };
    }
  },
  {
    declaration: {
      name: "update_memory",
      description:
        "Append a progress note to MEMORY.md under a section heading. Track progress by milestone reached (what the learner now understands / did), NOT by date.",
      parameters: {
        type: "object",
        properties: {
          section: { type: "string", description: "Section heading, e.g. a milestone name" },
          entry: { type: "string", description: "The note to append" }
        },
        required: ["section", "entry"]
      }
    },
    run: async (args, ctx) => {
      const section = str(args, "section");
      const entry = str(args, "entry");
      const abs = await assertSafePath(ctx.userHome, MEMORY_FILE);
      const existing = await readMemory(ctx.userHome);
      const next = `${existing.trimEnd()}\n\n### ${section}\n${entry}\n`.trimStart();
      await writeFile(abs, next, { mode: 0o600 });
      return { result: `Updated ${MEMORY_FILE}.` };
    }
  }
];

/** Function declarations sent to the model (Gemini `functionDeclarations`). */
export const TOOL_DECLARATIONS: ToolDeclaration[] = TOOLS.map((tool) => tool.declaration);

/** Execute a tool by name; throws (caught by the loop) on unknown tool / bad args. */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: AgentContext
): Promise<ToolResult> {
  const tool = TOOLS.find((entry) => entry.declaration.name === name);
  if (!tool) {
    throw new PathError(`Unknown tool: ${name}`, 400);
  }
  return tool.run(args, ctx);
}

export { readMemory };
