import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Embedder, EmbedKind } from "./embedding.js";
import { chunkMatches, evaluate, firstMatchRank, formatReport, parseGoldenJsonl } from "./eval.js";
import { JsonVectorStore, type RagHit, type StoredChunk } from "./store.js";

const dirs: string[] = [];

afterAll(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempStore(): Promise<JsonVectorStore> {
  const dir = await mkdtemp(path.join(tmpdir(), "rag-eval-test-"));
  dirs.push(dir);
  return new JsonVectorStore(path.join(dir, "index.json"), "stub-model", 3);
}

function chunk(id: string, doc: string, headingPath: string, text: string, embedding: number[]): StoredChunk {
  return { id, doc, headingPath, sourceUrl: `https://x/${id}`, text, embedding };
}

function hit(overrides: Partial<RagHit> = {}): RagHit {
  return {
    id: "a",
    doc: "CMSIS-Core (NVIC)",
    headingPath: "Interrupt Priority",
    sourceUrl: "https://x/a",
    text: "Lower numerical priority values mean higher urgency.",
    score: 0.9,
    ...overrides
  };
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

describe("chunkMatches", () => {
  it("matches case-insensitively on all expectTextIncludes tokens", () => {
    const h = hit();
    expect(chunkMatches(h, { q: "x", expectTextIncludes: ["LOWER numerical", "higher URGENCY"] })).toBe(true);
    expect(chunkMatches(h, { q: "x", expectTextIncludes: ["lower numerical", "not present"] })).toBe(false);
  });

  it("filters on expectDoc when set", () => {
    const h = hit({ doc: "CMSIS-Core (NVIC)" });
    expect(chunkMatches(h, { q: "x", expectDoc: "CMSIS-Core (NVIC)", expectTextIncludes: ["lower"] })).toBe(true);
    expect(chunkMatches(h, { q: "x", expectDoc: "Other Doc", expectTextIncludes: ["lower"] })).toBe(false);
  });

  it("filters on expectHeadingIncludes case-insensitively when set", () => {
    const h = hit({ headingPath: "Interrupt Priority" });
    expect(chunkMatches(h, { q: "x", expectHeadingIncludes: "priority", expectTextIncludes: ["lower"] })).toBe(true);
    expect(chunkMatches(h, { q: "x", expectHeadingIncludes: "gpio", expectTextIncludes: ["lower"] })).toBe(false);
  });
});

describe("firstMatchRank", () => {
  it("returns the 1-based rank of the first matching hit", () => {
    const hits = [
      hit({ id: "a", text: "unrelated" }),
      hit({ id: "b", text: "Lower numerical priority values" }),
      hit({ id: "c", text: "Lower numerical priority values" })
    ];
    expect(firstMatchRank(hits, { q: "x", expectTextIncludes: ["Lower numerical priority"] })).toBe(2);
  });

  it("returns 0 when no hit matches", () => {
    const hits = [hit({ text: "unrelated" })];
    expect(firstMatchRank(hits, { q: "x", expectTextIncludes: ["nonexistent token"] })).toBe(0);
  });
});

describe("parseGoldenJsonl", () => {
  it("skips blank lines and // comments", () => {
    const raw = [
      "// a comment",
      "",
      '{"q":"one?","expectTextIncludes":["a"]}',
      "   ",
      '{"q":"two?","expectTextIncludes":["b"]}'
    ].join("\n");
    const items = parseGoldenJsonl(raw);
    expect(items).toHaveLength(2);
    expect(items[0]?.q).toBe("one?");
    expect(items[1]?.q).toBe("two?");
  });

  it("throws on a line missing q", () => {
    expect(() => parseGoldenJsonl('{"expectTextIncludes":["a"]}')).toThrow(/missing "q"/);
  });

  it("throws on a line with empty expectTextIncludes", () => {
    expect(() => parseGoldenJsonl('{"q":"one?","expectTextIncludes":[]}')).toThrow(/expectTextIncludes/);
  });
});

describe("evaluate", () => {
  it("computes non-decreasing hitRate@k and MRR = 1/rank for a single hit", async () => {
    const store = await tempStore();
    // Orthogonal unit vectors so ranking against [1,0,0] is deterministic:
    // "a" is the exact match, "b"/"c" are decoys nudged off-axis.
    await store.add([
      chunk("b", "Other", "Other", "unrelated decoy one", [0, 1, 0]),
      chunk("c", "Other", "Other", "unrelated decoy two", [0, 0, 1]),
      chunk("a", "CMSIS-Core (NVIC)", "Interrupt Priority", "Lower numerical priority values mean higher urgency", [
        0.9, 0.1, 0
      ])
    ]);
    const golden = [{ q: "priority?", expectTextIncludes: ["Lower numerical priority"] }];
    const result = await evaluate(store, stubEmbedder([1, 0, 0]), golden, [1, 3, 5]);

    expect(result.n).toBe(1);
    expect(result.hitRate[1]).toBe(1);
    expect(result.hitRate[3]).toBe(1);
    expect(result.hitRate[5]).toBe(1);
    expect(result.mrr).toBeCloseTo(1);
    expect(result.hitRate[1]).toBeLessThanOrEqual(result.hitRate[3] ?? 0);
    expect(result.hitRate[3]).toBeLessThanOrEqual(result.hitRate[5] ?? 0);
  });

  it("a guaranteed-miss item pulls aggregate MRR + hitRate down", async () => {
    const store = await tempStore();
    await store.add([
      chunk("a", "CMSIS-Core (NVIC)", "Interrupt Priority", "Lower numerical priority values mean higher urgency", [
        1, 0, 0
      ])
    ]);
    const golden = [
      { q: "priority?", expectTextIncludes: ["Lower numerical priority"] },
      { q: "never matches?", expectTextIncludes: ["this text does not exist anywhere"] }
    ];
    const result = await evaluate(store, stubEmbedder([1, 0, 0]), golden, [1, 5]);

    expect(result.n).toBe(2);
    expect(result.hitRate[1]).toBeCloseTo(0.5);
    expect(result.mrr).toBeCloseTo(0.5);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.rank).toBe(0);
  });

  it("formatReport renders the hit-rate/MRR table and failures", async () => {
    const store = await tempStore();
    await store.add([chunk("a", "Doc", "Heading", "some text", [1, 0, 0])]);
    const golden = [{ q: "never matches?", expectTextIncludes: ["nonexistent"] }];
    const result = await evaluate(store, stubEmbedder([1, 0, 0]), golden, [1, 5]);
    const report = formatReport(result);
    expect(report).toContain("hit-rate@1");
    expect(report).toContain("hit-rate@5");
    expect(report).toContain("MRR");
    expect(report).toContain("Failures");
  });
});
