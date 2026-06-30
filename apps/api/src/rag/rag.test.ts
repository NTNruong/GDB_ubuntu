import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Embedder, EmbedKind } from "./embedding.js";
import { formatDocContext, searchDocs } from "./search.js";
import { cosineSim, JsonVectorStore, type StoredChunk } from "./store.js";

const dirs: string[] = [];

afterAll(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempStore(): Promise<JsonVectorStore> {
  const dir = await mkdtemp(path.join(tmpdir(), "rag-test-"));
  dirs.push(dir);
  return new JsonVectorStore(path.join(dir, "index.json"), "stub-model", 3);
}

function chunk(id: string, text: string, embedding: number[]): StoredChunk {
  return { id, doc: "Doc", headingPath: id, sourceUrl: `https://x/${id}`, text, embedding };
}

/** Stub that returns a fixed query vector regardless of the text. */
function stubEmbedder(vector: number[]): Embedder {
  return {
    modelId: "stub-model",
    async embed(_text: string, _kind: EmbedKind): Promise<number[]> {
      return vector;
    }
  };
}

describe("cosineSim", () => {
  it("is 1 for identical direction and 0 for orthogonal", () => {
    expect(cosineSim([1, 0, 0], [2, 0, 0])).toBeCloseTo(1);
    expect(cosineSim([1, 0, 0], [0, 1, 0])).toBeCloseTo(0);
  });

  it("returns 0 for a zero vector", () => {
    expect(cosineSim([0, 0, 0], [1, 2, 3])).toBe(0);
  });
});

describe("JsonVectorStore", () => {
  it("ranks by cosine similarity and persists across instances", async () => {
    const store = await tempStore();
    await store.add([
      chunk("a", "about NVIC interrupt priority", [1, 0, 0]),
      chunk("b", "about ESP32 GPIO config", [0, 1, 0]),
      chunk("c", "about the volatile keyword", [0.9, 0.1, 0])
    ]);
    expect(await store.size()).toBe(3);

    const hits = await store.search([1, 0, 0], 2);
    expect(hits.map((hit) => hit.id)).toEqual(["a", "c"]);
    expect(hits[0]?.score).toBeGreaterThan(hits[1]?.score ?? 1);
  });

  it("upserts by id (no duplicates)", async () => {
    const store = await tempStore();
    await store.add([chunk("a", "v1", [1, 0, 0])]);
    await store.add([chunk("a", "v2", [1, 0, 0])]);
    expect(await store.size()).toBe(1);
    const hits = await store.search([1, 0, 0], 1);
    expect(hits[0]?.text).toBe("v2");
  });
});

describe("searchDocs + formatDocContext", () => {
  it("embeds the query and returns ranked hits", async () => {
    const store = await tempStore();
    await store.add([
      chunk("a", "interrupt priority", [1, 0, 0]),
      chunk("b", "gpio", [0, 1, 0])
    ]);
    const hits = await searchDocs(store, stubEmbedder([1, 0, 0]), "how do interrupts work", 1);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.id).toBe("a");
  });

  it("returns [] for a blank query without calling the store", async () => {
    const store = await tempStore();
    await store.add([chunk("a", "x", [1, 0, 0])]);
    expect(await searchDocs(store, stubEmbedder([1, 0, 0]), "   ", 3)).toEqual([]);
  });

  it("formats citations with numbered sources, empty for no hits", () => {
    expect(formatDocContext([])).toBe("");
    const block = formatDocContext([
      { id: "a", doc: "CMSIS", headingPath: "NVIC", sourceUrl: "https://x/a", text: "priority bits", score: 0.9 }
    ]);
    expect(block).toContain("[1] CMSIS — NVIC");
    expect(block).toContain("https://x/a");
    expect(block).toContain("priority bits");
  });
});
