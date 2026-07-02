/**
 * RAG retrieval eval harness (operator task, run against a real index):
 *
 *   GEMINI_API_KEY=… RAG_DATA_ROOT=… npm run -w @internal/api rag:eval -- eval/rag-golden.jsonl
 *
 * Retrieves top-K for each golden question and reports hit-rate@k + MRR, so
 * retrieval quality is measured instead of assumed. See docs/RAG.md.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readConfig } from "../config.js";
import type { Embedder } from "./embedding.js";
import { makeGeminiEmbedder } from "./embedding.js";
import { searchDocs } from "./search.js";
import { JsonVectorStore, type RagHit, type VectorStore } from "./store.js";

/** One golden question + the predicate a retrieved hit must satisfy. */
export type GoldenItem = {
  q: string;
  /** Optional: must === hit.doc. */
  expectDoc?: string;
  /** Optional: case-insensitive substring of hit.headingPath. */
  expectHeadingIncludes?: string;
  /** Required, non-empty: ALL must be case-insensitive substrings of hit.text. */
  expectTextIncludes: string[];
};

export type EvalResult = {
  n: number;
  /** k → fraction of items whose first matching hit ranks within k. */
  hitRate: Record<number, number>;
  /** Mean of 1/rank over items (0 contribution for a miss within the retrieved K). */
  mrr: number;
  failures: { q: string; rank: number; top1?: { doc: string; headingPath: string } }[];
};

const DEFAULT_KS = [1, 3, 5, 10];
const HIT_RATE_5_GATE = 0.85;

/** Whether `hit` satisfies `item`'s predicate (all-of text, case-insensitive). */
export function chunkMatches(hit: RagHit, item: GoldenItem): boolean {
  if (item.expectDoc !== undefined && hit.doc !== item.expectDoc) {
    return false;
  }
  if (
    item.expectHeadingIncludes !== undefined &&
    !hit.headingPath.toLowerCase().includes(item.expectHeadingIncludes.toLowerCase())
  ) {
    return false;
  }
  const haystack = hit.text.toLowerCase();
  return item.expectTextIncludes.every((token) => haystack.includes(token.toLowerCase()));
}

/** 1-based rank of the first matching hit, or 0 if none of `hits` match. */
export function firstMatchRank(hits: RagHit[], item: GoldenItem): number {
  for (const [index, hit] of hits.entries()) {
    if (chunkMatches(hit, item)) {
      return index + 1;
    }
  }
  return 0;
}

/**
 * Tolerant JSONL: blank lines and lines starting with `//` are skipped (comments).
 * Throws on a line that parses as JSON but is missing `q` or has an empty
 * `expectTextIncludes` — a malformed golden fixture should fail loud, not silently
 * under-count.
 */
export function parseGoldenJsonl(raw: string): GoldenItem[] {
  const items: GoldenItem[] = [];
  const lines = raw.split(/\r?\n/);
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("//")) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      throw new Error(`rag-golden line ${index + 1}: invalid JSON (${(error as Error).message})`);
    }
    const item = parsed as Partial<GoldenItem>;
    if (!item.q || typeof item.q !== "string") {
      throw new Error(`rag-golden line ${index + 1}: missing "q"`);
    }
    if (!Array.isArray(item.expectTextIncludes) || item.expectTextIncludes.length === 0) {
      throw new Error(`rag-golden line ${index + 1}: "expectTextIncludes" must be a non-empty array`);
    }
    items.push({
      q: item.q,
      expectDoc: item.expectDoc,
      expectHeadingIncludes: item.expectHeadingIncludes,
      expectTextIncludes: item.expectTextIncludes
    });
  }
  return items;
}

/** Retrieves top-K once per item (K = max(ks)) and derives hitRate@k + MRR + failures. */
export async function evaluate(
  store: VectorStore,
  embedder: Embedder,
  golden: GoldenItem[],
  ks: number[] = DEFAULT_KS
): Promise<EvalResult> {
  const maxK = Math.max(...ks);
  const ranks: number[] = [];
  const failures: EvalResult["failures"] = [];

  for (const item of golden) {
    const hits = await searchDocs(store, embedder, item.q, maxK);
    const rank = firstMatchRank(hits, item);
    ranks.push(rank);
    if (rank === 0 || rank > 5) {
      const top1 = hits[0];
      failures.push({
        q: item.q,
        rank,
        top1: top1 ? { doc: top1.doc, headingPath: top1.headingPath } : undefined
      });
    }
  }

  const n = golden.length;
  const hitRate: Record<number, number> = {};
  for (const k of ks) {
    const hitCount = ranks.filter((rank) => rank > 0 && rank <= k).length;
    hitRate[k] = n === 0 ? 0 : hitCount / n;
  }
  const mrrSum = ranks.reduce((sum, rank) => sum + (rank > 0 ? 1 / rank : 0), 0);
  const mrr = n === 0 ? 0 : mrrSum / n;

  return { n, hitRate, mrr, failures };
}

/** ASCII report: hit-rate@k / MRR table plus the failure list (rank>5 or miss). */
export function formatReport(r: EvalResult): string {
  const lines: string[] = [];
  lines.push(`n = ${r.n}`);
  const ks = Object.keys(r.hitRate)
    .map(Number)
    .sort((a, b) => a - b);
  for (const k of ks) {
    lines.push(`hit-rate@${k}: ${(r.hitRate[k] ?? 0).toFixed(3)}`);
  }
  lines.push(`MRR: ${r.mrr.toFixed(3)}`);
  if (r.failures.length > 0) {
    lines.push("", "Failures (rank>5 or miss):");
    for (const failure of r.failures) {
      const rankLabel = failure.rank === 0 ? "miss" : `rank ${failure.rank}`;
      const top1 = failure.top1 ? `${failure.top1.doc} — ${failure.top1.headingPath}` : "(no hits)";
      lines.push(`  [${rankLabel}] "${failure.q}" → top1: ${top1}`);
    }
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  const config = readConfig();
  if (!config.geminiApiKey) {
    throw new Error("GEMINI_API_KEY is required to embed eval queries");
  }
  const embedder = makeGeminiEmbedder(config.geminiApiKey, config);
  if (!embedder) {
    throw new Error("Failed to build the Gemini embedder");
  }
  const store = new JsonVectorStore(
    path.join(config.ragDataRoot, "index.json"),
    config.ragEmbeddingModel,
    config.ragEmbedDim
  );
  if ((await store.size()) === 0) {
    process.stderr.write("index empty — run rag:ingest first\n");
    process.exitCode = 1;
    return;
  }

  const goldenPath = path.resolve(process.argv[2] ?? "eval/rag-golden.sample.jsonl");
  const golden = parseGoldenJsonl(await readFile(goldenPath, "utf8"));

  const result = await evaluate(store, embedder, golden);
  process.stdout.write(`${formatReport(result)}\n`);
  const hitRate5 = result.hitRate[5] ?? 0;
  const verdict = hitRate5 >= HIT_RATE_5_GATE ? "PASS" : "WEAK";
  process.stdout.write(`\n${verdict}: hit-rate@5 = ${hitRate5.toFixed(3)} (gate ${HIT_RATE_5_GATE})\n`);
}

const isDirectRun =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((error: unknown) => {
    process.stderr.write(`Eval failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
