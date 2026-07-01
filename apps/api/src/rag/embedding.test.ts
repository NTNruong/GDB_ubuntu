import { afterEach, describe, expect, it, vi } from "vitest";
import { GeminiEmbedder } from "./embedding.js";

function ok(values: number[]): Response {
  return new Response(JSON.stringify({ embedding: { values } }), { status: 200 });
}

function rateLimited(): Response {
  // Retry-After: 0 keeps the test fast (no real backoff wait).
  return new Response('{"error":{"status":"RESOURCE_EXHAUSTED"}}', {
    status: 429,
    headers: { "retry-after": "0" }
  });
}

describe("GeminiEmbedder retry", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retries a 429 then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(rateLimited())
      .mockResolvedValueOnce(ok([0.1, 0.2, 0.3]));
    vi.stubGlobal("fetch", fetchMock);

    const embedder = new GeminiEmbedder("k", "gemini-embedding-001", 3, true, 3);
    await expect(embedder.embed("hi", "document")).resolves.toEqual([0.1, 0.2, 0.3]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after exhausting retries", async () => {
    const fetchMock = vi.fn().mockResolvedValue(rateLimited());
    vi.stubGlobal("fetch", fetchMock);

    const embedder = new GeminiEmbedder("k", "gemini-embedding-001", 3, true, 2);
    await expect(embedder.embed("hi", "document")).rejects.toThrow(/429/);
    expect(fetchMock).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("omits taskType and prefixes the query for gemini-embedding-2", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok([0.5]));
    vi.stubGlobal("fetch", fetchMock);

    const embedder = new GeminiEmbedder("k", "gemini-embedding-2", 1);
    await embedder.embed("volatile keyword", "query");

    const sent = JSON.parse((fetchMock.mock.calls[0]?.[1] as { body: string }).body);
    expect(sent.taskType).toBeUndefined();
    expect(sent.content.parts[0].text).toBe("task: search result | query: volatile keyword");
  });

  it("still sends taskType for gemini-embedding-001", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok([0.5]));
    vi.stubGlobal("fetch", fetchMock);

    const embedder = new GeminiEmbedder("k", "gemini-embedding-001", 1);
    await embedder.embed("volatile keyword", "query");

    const sent = JSON.parse((fetchMock.mock.calls[0]?.[1] as { body: string }).body);
    expect(sent.taskType).toBe("RETRIEVAL_QUERY");
    expect(sent.content.parts[0].text).toBe("volatile keyword");
  });
});
