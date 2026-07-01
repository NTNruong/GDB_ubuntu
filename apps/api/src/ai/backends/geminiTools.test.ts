import { afterEach, describe, expect, it, vi } from "vitest";
import { geminiToolTurn } from "./geminiTools.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

const signal = new AbortController().signal;

describe("geminiToolTurn", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("parses a functionCall + usage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          candidates: [{ content: { parts: [{ functionCall: { name: "read_file", args: { path: "a.c" } } }] } }],
          usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 }
        })
      )
    );
    const turn = await geminiToolTurn("k", "gemini-flash-latest", "sys", [], [], signal);
    expect(turn.functionCalls).toEqual([{ name: "read_file", args: { path: "a.c" } }]);
    expect(turn.text).toBe("");
    expect(turn.usage).toEqual({ promptTokens: 5, completionTokens: 2 });
  });

  it("parses a final text answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ candidates: [{ content: { parts: [{ text: "done" }] } }] }))
    );
    const turn = await geminiToolTurn("k", "gemini-flash-latest", "sys", [], [], signal);
    expect(turn.functionCalls).toEqual([]);
    expect(turn.text).toBe("done");
  });

  it("throws on error with no retries left", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("nope", { status: 400 }))
    );
    await expect(geminiToolTurn("k", "gemini-flash-latest", "sys", [], [], signal, 0)).rejects.toThrow(/400/);
  });
});
