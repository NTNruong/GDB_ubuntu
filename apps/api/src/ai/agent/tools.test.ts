import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MEMORY_FILE, STUDY_PLAN_FILE, executeTool, type AgentContext } from "./tools.js";

const noopLog = { warn() {}, info() {}, error() {}, debug() {} } as unknown as AgentContext["log"];

describe("agent tools", () => {
  let home: string;
  let ctx: AgentContext;

  beforeEach(async () => {
    home = await mkdtemp(path.join(tmpdir(), "gdb-agent-"));
    ctx = { userHome: home, store: null, embedder: null, log: noopLog };
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it("read_file returns 1-based numbered lines", async () => {
    await writeFile(path.join(home, "main.c"), "int main(){\n  return 0;\n}");
    const { result } = await executeTool("read_file", { path: "main.c" }, ctx);
    expect(result).toBe("1\tint main(){\n2\t  return 0;\n3\t}");
  });

  it("list_dir lists workspace entries", async () => {
    await writeFile(path.join(home, "a.py"), "print(1)");
    const { result } = await executeTool("list_dir", {}, ctx);
    expect(result).toContain("a.py");
  });

  it("propose_edit emits a step and does NOT write", async () => {
    await writeFile(path.join(home, "x.c"), "old\nline2");
    const { step, result } = await executeTool(
      "propose_edit",
      { path: "x.c", startLine: 1, endLine: 1, replacement: "new", note: "fix" },
      ctx
    );
    expect(step).toEqual({ kind: "proposed_edit", path: "x.c", startLine: 1, endLine: 1, replacement: "new", note: "fix" });
    expect(result).toContain("Waiting for the learner");
    // File is untouched — propose is not apply.
    expect(await readFile(path.join(home, "x.c"), "utf8")).toBe("old\nline2");
  });

  it("write_study_plan writes STUDY_PLAN.md", async () => {
    await executeTool("write_study_plan", { markdown: "# Plan\n- step" }, ctx);
    expect(await readFile(path.join(home, STUDY_PLAN_FILE), "utf8")).toBe("# Plan\n- step");
  });

  it("read_memory / update_memory round-trip", async () => {
    const empty = await executeTool("read_memory", {}, ctx);
    expect(empty.result).toContain("empty");
    await executeTool("update_memory", { section: "Pointers", entry: "understands &x" }, ctx);
    const memory = await readFile(path.join(home, MEMORY_FILE), "utf8");
    expect(memory).toContain("### Pointers");
    expect(memory).toContain("understands &x");
  });

  it("search_docs reports unavailable without an index", async () => {
    const { result } = await executeTool("search_docs", { query: "nvic" }, ctx);
    expect(result).toContain("unavailable");
  });

  it("rejects a traversal path", async () => {
    await expect(executeTool("read_file", { path: "../escape" }, ctx)).rejects.toThrow();
  });

  it("throws on an unknown tool", async () => {
    await expect(executeTool("rm_rf", {}, ctx)).rejects.toThrow(/Unknown tool/);
  });
});
