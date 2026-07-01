import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AiStreamEvent } from "@internal/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAgent } from "./agentLoop.js";
import type { AgentContext } from "./tools.js";

const noopLog = { warn() {}, info() {}, error() {}, debug() {} } as unknown as AgentContext["log"];

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

/** A model turn that calls one tool. */
function callTurn(name: string, args: Record<string, unknown>): Response {
  return jsonResponse({ candidates: [{ content: { parts: [{ functionCall: { name, args } }] } }] });
}

/** A model turn with a final text answer. */
function textTurn(text: string): Response {
  return jsonResponse({ candidates: [{ content: { parts: [{ text }] } }] });
}

describe("runAgent", () => {
  let home: string;
  let ctx: AgentContext;

  beforeEach(async () => {
    home = await mkdtemp(path.join(tmpdir(), "gdb-loop-"));
    ctx = { userHome: home, store: null, embedder: null, log: noopLog };
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(home, { recursive: true, force: true });
  });

  it("calls a tool then streams the final answer", async () => {
    await writeFile(path.join(home, "main.c"), "int main(){}");
    // Turn 1: read_file; Turn 2: final text.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(callTurn("read_file", { path: "main.c" }))
      .mockResolvedValueOnce(textTurn("Looks good."));
    vi.stubGlobal("fetch", fetchMock);

    const events: AiStreamEvent[] = [];
    const gen = runAgent("k", "gemini-flash-latest", "sys", [], "review my file", ctx, new AbortController().signal);
    let next = await gen.next();
    while (!next.done) {
      events.push(next.value);
      next = await gen.next();
    }

    const kinds = events.map((event) => (event.type === "step" ? event.step.kind : event.type));
    expect(kinds).toEqual(["tool_call", "tool_result", "token"]);
    const token = events.find((event) => event.type === "token");
    expect(token).toEqual({ type: "token", data: "Looks good." });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces a proposed_edit step", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        callTurn("propose_edit", { path: "main.c", startLine: 1, endLine: 1, replacement: "int main(void){}" })
      )
      .mockResolvedValueOnce(textTurn("Proposed a fix."));
    vi.stubGlobal("fetch", fetchMock);

    const steps: AiStreamEvent[] = [];
    const gen = runAgent("k", "gemini-flash-latest", "sys", [], "fix it", ctx, new AbortController().signal);
    let next = await gen.next();
    while (!next.done) {
      steps.push(next.value);
      next = await gen.next();
    }
    const proposed = steps.find((event) => event.type === "step" && event.step.kind === "proposed_edit");
    expect(proposed).toBeTruthy();
  });
});
