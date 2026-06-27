import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractGeminiToken, toGeminiBody } from "./backends/gemini.js";
import { extractLlamaToken } from "./backends/llama.js";
import { parseSseData } from "./sse.js";
import {
  appendMessages,
  createThread,
  deleteThread,
  listThreads,
  readThread,
  titleFromMessage
} from "./threads.js";
import { PathError } from "../pathSafety.js";

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

  it("creates, appends, lists and deletes threads", async () => {
    const thread = await createThread(dir, "local-gemma-e4b", "First");
    await appendMessages(dir, thread.id, [
      { role: "user", content: "hi", at: 1 },
      { role: "assistant", content: "hello", at: 2 }
    ]);

    const loaded = await readThread(dir, thread.id);
    expect(loaded.messages.map((m) => m.content)).toEqual(["hi", "hello"]);

    const list = await listThreads(dir);
    expect(list).toHaveLength(1);
    expect(list[0]?.title).toBe("First");

    await deleteThread(dir, thread.id);
    expect(await listThreads(dir)).toHaveLength(0);
    await expect(readThread(dir, thread.id)).rejects.toBeInstanceOf(PathError);
  });

  it("rejects an unsafe thread id", async () => {
    await expect(readThread(dir, "../escape")).rejects.toBeInstanceOf(PathError);
  });
});
