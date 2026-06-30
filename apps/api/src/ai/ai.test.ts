import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractAgentEvents, newAgentSeen, toAgentInput } from "./backends/antigravity.js";
import { extractGeminiToken, extractGeminiUsage, toGeminiBody } from "./backends/gemini.js";
import { extractLlamaReasoning, extractLlamaToken, extractLlamaUsage } from "./backends/llama.js";
import { decryptSecret, encryptSecret, loadUserKey, storeUserKey, userKeyInfo } from "./keystore.js";
import { buildSystemPrompt } from "./prompts.js";
import { parseSseData } from "./sse.js";
import {
  addNode,
  createThread,
  deleteSubtree,
  deleteThread,
  listThreads,
  migrateThread,
  pathToLeaf,
  readThread,
  setCurrentLeaf,
  titleFromMessage
} from "./threads.js";
import { PathError } from "../pathSafety.js";
import { writeFile } from "node:fs/promises";

async function* bytes(...chunks: string[]): AsyncGenerator<Uint8Array> {
  const encoder = new TextEncoder();
  for (const chunk of chunks) {
    yield encoder.encode(chunk);
  }
}

async function collect(iter: AsyncGenerator<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const value of iter) {
    out.push(value);
  }
  return out;
}

describe("ai sse parser", () => {
  it("yields data payloads split across arbitrary chunk boundaries", async () => {
    const result = await collect(parseSseData(bytes("data: a\n\nda", "ta: b\n", "\ndata: c\n\n")));
    expect(result).toEqual(["a", "b", "c"]);
  });

  it("ignores non-data lines and flushes a trailing data line", async () => {
    const result = await collect(parseSseData(bytes(": keep-alive\nevent: x\ndata: last")));
    expect(result).toEqual(["last"]);
  });
});

describe("llama token extraction", () => {
  it("reads the delta content", () => {
    expect(extractLlamaToken(JSON.stringify({ choices: [{ delta: { content: "Hi" } }] }))).toBe("Hi");
  });
  it("returns empty for [DONE], blanks and malformed json", () => {
    expect(extractLlamaToken("[DONE]")).toBe("");
    expect(extractLlamaToken("")).toBe("");
    expect(extractLlamaToken("{not json")).toBe("");
    expect(extractLlamaToken(JSON.stringify({ choices: [{}] }))).toBe("");
  });
  it("extracts usage from the final include_usage chunk, null otherwise", () => {
    expect(
      extractLlamaUsage(JSON.stringify({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 8 } }))
    ).toEqual({ promptTokens: 12, completionTokens: 8 });
    expect(extractLlamaUsage(JSON.stringify({ choices: [{ delta: { content: "hi" } }] }))).toBeNull();
    expect(extractLlamaUsage("[DONE]")).toBeNull();
  });
  it("reads reasoning_content deltas, empty otherwise", () => {
    expect(
      extractLlamaReasoning(JSON.stringify({ choices: [{ delta: { reasoning_content: "hmm" } }] }))
    ).toBe("hmm");
    expect(extractLlamaReasoning(JSON.stringify({ choices: [{ delta: { content: "hi" } }] }))).toBe("");
    expect(extractLlamaReasoning("[DONE]")).toBe("");
    expect(extractLlamaReasoning("{not json")).toBe("");
  });
});

describe("gemini mapping", () => {
  it("maps roles and lifts system messages into systemInstruction", () => {
    const body = toGeminiBody([
      { role: "system", content: "sys" },
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" }
    ]);
    expect(body.systemInstruction).toEqual({ parts: [{ text: "sys" }] });
    expect(body.contents).toEqual([
      { role: "user", parts: [{ text: "hello" }] },
      { role: "model", parts: [{ text: "hi" }] }
    ]);
  });

  it("extracts candidate text and tolerates malformed json", () => {
    expect(
      extractGeminiToken(JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }))
    ).toBe("ok");
    expect(extractGeminiToken("nope")).toBe("");
  });

  it("extracts usage from usageMetadata, null otherwise", () => {
    expect(
      extractGeminiUsage(JSON.stringify({ usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 5 } }))
    ).toEqual({ promptTokens: 30, completionTokens: 5 });
    expect(extractGeminiUsage(JSON.stringify({ candidates: [] }))).toBeNull();
  });
});

describe("antigravity agent backend", () => {
  it("builds input with persona on the first turn, message-only on continuation", () => {
    const first = toAgentInput("PERSONA", "explain pointers", false);
    expect(first).toContain("PERSONA");
    expect(first).toContain("explain pointers");
    expect(toAgentInput("PERSONA", "explain pointers", true)).toBe("explain pointers");
  });

  it("emits answer text as incremental token deltas", () => {
    const seen = newAgentSeen();
    const step = (text: string) => ({ steps: [{ type: "model_output", content: [{ type: "text", text }] }] });
    expect(extractAgentEvents(step("Hel"), seen)).toEqual([{ type: "token", data: "Hel" }]);
    expect(extractAgentEvents(step("Hello"), seen)).toEqual([{ type: "token", data: "lo" }]);
    expect(extractAgentEvents(step("Hello"), seen)).toEqual([]);
  });

  it("emits code-execution steps once and de-dups on re-read", () => {
    const seen = newAgentSeen();
    const snap = {
      steps: [
        { type: "code_execution_call", id: "c1", arguments: { language: "python", code: "print(1)" } },
        { type: "code_execution_result", call_id: "c1", result: "1\n", is_error: false }
      ]
    };
    expect(extractAgentEvents(snap, seen)).toEqual([
      { type: "step", step: { kind: "code_call", language: "python", code: "print(1)" } },
      { type: "step", step: { kind: "code_result", result: "1\n", isError: false } }
    ]);
    expect(extractAgentEvents(snap, seen)).toEqual([]);
  });

  it("surfaces images and prefers output_text for the final answer", () => {
    const imgSeen = newAgentSeen();
    expect(
      extractAgentEvents(
        { steps: [{ type: "model_output", content: [{ type: "image", data: "B64", mime_type: "image/png" }] }] },
        imgSeen
      )
    ).toEqual([{ type: "step", step: { kind: "image", mimeType: "image/png", dataBase64: "B64" } }]);

    const txtSeen = newAgentSeen();
    expect(extractAgentEvents({ status: "completed", output_text: "Final", steps: [] }, txtSeen)).toEqual([
      { type: "token", data: "Final" }
    ]);
  });
});

describe("system prompt attachments", () => {
  const skill = { kind: "language_syntax" as const, language: "python" as const };

  it("renders each attached file's path and content in a fenced block", () => {
    const prompt = buildSystemPrompt("answer", skill, undefined, [
      { path: "pkg/util.py", content: "def add(a, b):\n    return a + b" }
    ]);
    expect(prompt).toContain("Attached workspace files");
    expect(prompt).toContain("`pkg/util.py`");
    expect(prompt).toContain("def add(a, b):");
  });

  it("omits the attachments section when none are given or the list is empty", () => {
    const base = buildSystemPrompt("answer", skill);
    expect(base).not.toContain("Attached workspace files");
    expect(buildSystemPrompt("answer", skill, undefined, [])).toBe(base);
  });

  it("instructs the model to wrap reasoning in a single <think> block (ISSUE-091)", () => {
    const prompt = buildSystemPrompt("answer", skill);
    expect(prompt).toContain("<think>");
    expect(prompt).toContain("</think>");
  });
});

describe("ai thread store", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "gdb-ai-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("titles from the first message", () => {
    expect(titleFromMessage("  explain   pointers  ")).toBe("explain pointers");
    expect(titleFromMessage("x".repeat(100))).toHaveLength(60);
    expect(titleFromMessage("   ")).toBe("New chat");
  });

  it("creates, appends nodes, lists and deletes threads", async () => {
    const thread = await createThread(dir, "local-gemma-e4b", "First");
    const user = await addNode(dir, thread.id, { parentId: null, role: "user", content: "hi" });
    await addNode(dir, thread.id, { parentId: user.id, role: "assistant", content: "hello" });

    const loaded = await readThread(dir, thread.id);
    expect(pathToLeaf(loaded, loaded.currentLeafId).map((n) => n.content)).toEqual(["hi", "hello"]);

    const list = await listThreads(dir);
    expect(list).toHaveLength(1);
    expect(list[0]?.title).toBe("First");

    await deleteThread(dir, thread.id);
    expect(await listThreads(dir)).toHaveLength(0);
    await expect(readThread(dir, thread.id)).rejects.toBeInstanceOf(PathError);
  });

  it("branches on edit and switches the active path via the leaf", async () => {
    const thread = await createThread(dir, "m", "t");
    const u1 = await addNode(dir, thread.id, { parentId: null, role: "user", content: "Q1" });
    const a1 = await addNode(dir, thread.id, { parentId: u1.id, role: "assistant", content: "A1" });
    // Edit Q1 → a sibling user node under the same (null) parent + its answer.
    const u2 = await addNode(dir, thread.id, { parentId: null, role: "user", content: "Q1b" });
    const a2 = await addNode(dir, thread.id, { parentId: u2.id, role: "assistant", content: "A2" });

    let loaded = await readThread(dir, thread.id);
    // currentLeafId follows the latest add (a2) → second branch.
    expect(pathToLeaf(loaded, loaded.currentLeafId).map((n) => n.content)).toEqual(["Q1b", "A2"]);
    // Both Q1 and Q1b are root variants.
    expect(loaded.nodes.filter((n) => n.parentId === null)).toHaveLength(2);

    // Switch back to the first branch.
    await setCurrentLeaf(dir, thread.id, a1.id);
    loaded = await readThread(dir, thread.id);
    expect(pathToLeaf(loaded, loaded.currentLeafId).map((n) => n.content)).toEqual(["Q1", "A1"]);

    // Deleting u2 prunes its subtree (a2) and repoints the leaf off the dead branch.
    await deleteSubtree(dir, thread.id, u2.id);
    loaded = await readThread(dir, thread.id);
    expect(loaded.nodes.some((n) => n.id === a2.id)).toBe(false);
    expect(loaded.nodes.some((n) => n.id === u2.id)).toBe(false);
  });

  it("migrates a legacy linear thread to a node chain on read", async () => {
    const legacy = {
      id: "legacy01",
      title: "Old",
      model: "m",
      createdAt: 1,
      updatedAt: 2,
      messages: [
        { role: "user", content: "hi", at: 1 },
        { role: "assistant", content: "hello", at: 2 }
      ]
    };
    await writeFile(path.join(dir, "legacy01.json"), JSON.stringify(legacy));
    const loaded = await readThread(dir, "legacy01");
    expect(loaded.nodes).toHaveLength(2);
    expect(pathToLeaf(loaded, loaded.currentLeafId).map((n) => n.content)).toEqual(["hi", "hello"]);
    // migrateThread is a pure helper: the chain links assistant→user.
    const migrated = migrateThread(legacy as never);
    expect(migrated.nodes[1]?.parentId).toBe(migrated.nodes[0]?.id);
    expect(migrated.nodes[0]?.parentId).toBeNull();
  });

  it("rejects an unsafe thread id", async () => {
    await expect(readThread(dir, "../escape")).rejects.toBeInstanceOf(PathError);
  });
});

describe("ai key store", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "gdb-aikey-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("round-trips a key via AES-GCM and fails to decrypt with the wrong secret", () => {
    const blob = encryptSecret("secretA", "AIzaSECRET1234");
    expect(blob).not.toContain("AIzaSECRET1234");
    expect(decryptSecret("secretA", blob)).toBe("AIzaSECRET1234");
    expect(() => decryptSecret("secretB", blob)).toThrow();
  });

  it("stores, masks and removes a user key", async () => {
    expect(await userKeyInfo(dir, "s")).toEqual({ hasKey: false });

    await storeUserKey(dir, "s", "AIzaABCDEFGH1234");
    expect(await loadUserKey(dir, "s")).toBe("AIzaABCDEFGH1234");
    expect(await userKeyInfo(dir, "s")).toEqual({ hasKey: true, last4: "1234" });

    // A wrong secret can't decrypt → treated as no usable key.
    expect(await loadUserKey(dir, "wrong")).toBeNull();
  });
});
