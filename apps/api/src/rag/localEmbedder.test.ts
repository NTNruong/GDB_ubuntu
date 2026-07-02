import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalEmbedder } from "./localEmbedder.js";

function ok(embedding: number[]): Response {
  return new Response(JSON.stringify({ data: [{ embedding }] }), { status: 200 });
}

describe("LocalEmbedder", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("posts plain input for a document embed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok([0.1, 0.2]));
    vi.stubGlobal("fetch", fetchMock);

    const embedder = new LocalEmbedder("http://host:8001", "qwen3-embedding-0.6b", "");
    await expect(embedder.embed("GPIO configuration", "document")).resolves.toEqual([0.1, 0.2]);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://host:8001/v1/embeddings");
    const sent = JSON.parse(init.body as string);
    expect(sent.model).toBe("qwen3-embedding-0.6b");
    expect(sent.input).toBe("GPIO configuration");
  });

  it("prefixes an instruction for a query embed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok([0.5]));
    vi.stubGlobal("fetch", fetchMock);

    const embedder = new LocalEmbedder("http://host:8001", "qwen3-embedding-0.6b", "");
    await embedder.embed("How does NVIC priority work?", "query");

    const sent = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(sent.input as string).toMatch(/^Instruct: .*\nQuery: How does NVIC priority work\?$/);
  });

  it("sends a bearer header only when an api key is set", async () => {
    // A fresh Response per call — its body can only be read (json()) once.
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(ok([0.1])));
    vi.stubGlobal("fetch", fetchMock);

    await new LocalEmbedder("http://host:8001", "m", "").embed("x", "document");
    let headers = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();

    fetchMock.mockClear();
    await new LocalEmbedder("http://host:8001", "m", "secret").embed("x", "document");
    headers = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer secret");
  });

  it("throws when the response has no embedding values", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const embedder = new LocalEmbedder("http://host:8001", "m", "");
    await expect(embedder.embed("x", "document")).rejects.toThrow(/no values/);
  });

  it("retries a 429 then succeeds", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 429 }))
      .mockResolvedValueOnce(ok([0.9]));
    vi.stubGlobal("fetch", fetchMock);

    const embedder = new LocalEmbedder("http://host:8001", "m", "", 3);
    const result = embedder.embed("x", "document");
    await vi.runAllTimersAsync();
    await expect(result).resolves.toEqual([0.9]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after exhausting retries", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(new Response("down", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    const embedder = new LocalEmbedder("http://host:8001", "m", "", 2);
    // Attach the rejection assertion before advancing timers, so the rejection
    // is never briefly "unhandled" (Node would otherwise warn about it).
    const assertion = expect(embedder.embed("x", "document")).rejects.toThrow(/503/);
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3); // initial + 2 retries
  });
});
