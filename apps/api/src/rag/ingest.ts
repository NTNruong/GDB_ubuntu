/**
 * RAG corpus ingestion CLI (operator task, run with the server's GEMINI key):
 *
 *   GEMINI_API_KEY=… RAG_DATA_ROOT=… npm run -w @internal/api rag:ingest -- corpus/corpus.manifest.json
 *
 * Reads a manifest of already-converted markdown files (HTML/PDF → .md via
 * markitdown or Docling beforehand), chunks each heading-aware, embeds every
 * chunk as a document, and writes the flat JSON index the chat route reads.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { readConfig } from "../config.js";
import { chunkMarkdown } from "./chunk.js";
import { GeminiEmbedder } from "./embedding.js";
import { QuotaExhaustedError, getEmbedRateLimiter } from "./rateLimiter.js";
import { JsonVectorStore, type StoredChunk } from "./store.js";

type ManifestEntry = {
  /** Markdown file path, relative to the manifest's directory. */
  file: string;
  /** Display label for citations, e.g. "CMSIS-Core". */
  doc: string;
  /** Canonical source URL for citations. */
  sourceUrl: string;
  /** Licensing bucket (informational): "public" | "private" | "restricted". */
  bucket?: string;
};

type Manifest = { entries: ManifestEntry[] };

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const config = readConfig();
  if (!config.geminiApiKey) {
    throw new Error("GEMINI_API_KEY is required to embed the corpus");
  }
  // Throttle between embedding calls so a large corpus doesn't blow the Gemini
  // per-minute quota (the embedder also retries 429s). CLI-only knob → read the
  // env here rather than bloating ApiConfig (ISSUE-097).
  const delayMs = Number.parseInt(process.env.RAG_INGEST_DELAY_MS ?? "200", 10);
  const manifestPath = path.resolve(process.argv[2] ?? "corpus/corpus.manifest.json");
  const corpusDir = path.dirname(manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;

  // Patient wait budget: ride out per-minute throttling instead of crashing, but stop
  // cleanly (rather than hang ~24h) once the daily cap is hit — a re-run then resumes.
  const maxWaitMs = Number.parseInt(process.env.RAG_INGEST_MAX_WAIT_MS ?? "300000", 10);
  const limiter = getEmbedRateLimiter({
    rpm: config.ragEmbedRpm,
    tpm: config.ragEmbedTpm,
    rpd: config.ragEmbedRpd
  });
  const embedder = new GeminiEmbedder(
    config.geminiApiKey,
    config.ragEmbeddingModel,
    config.ragEmbedDim,
    undefined,
    5,
    limiter,
    maxWaitMs
  );
  const store = new JsonVectorStore(
    path.join(config.ragDataRoot, "index.json"),
    config.ragEmbeddingModel,
    config.ragEmbedDim
  );
  // Resume support: skip chunks already embedded (same id) so an interrupted run — or one
  // stopped by the daily quota — picks up where it left off without re-spending quota.
  const existing = await store.existingIds();

  let total = 0;
  let skipped = 0;
  for (const entry of manifest.entries) {
    const markdown = await readFile(path.join(corpusDir, entry.file), "utf8");
    const chunks = chunkMarkdown(markdown);
    const stored: StoredChunk[] = [];
    try {
      for (const [index, chunk] of chunks.entries()) {
        const id = `${slug(entry.doc)}#${index}`;
        if (existing.has(id)) {
          skipped += 1;
          continue;
        }
        const embedding = await embedder.embed(chunk.text, "document");
        if (delayMs > 0) {
          await sleep(delayMs);
        }
        stored.push({
          id,
          doc: entry.doc,
          headingPath: chunk.headingPath,
          sourceUrl: entry.sourceUrl,
          text: chunk.text,
          embedding
        });
      }
    } catch (error) {
      if (error instanceof QuotaExhaustedError) {
        // Persist whatever this doc managed before the cap so the resume run is shorter.
        await store.add(stored);
        total += stored.length;
        process.stdout.write(
          `Daily embedding quota reached after ${total} new chunks (${skipped} skipped). Re-run to resume.\n`
        );
        return;
      }
      throw error;
    }
    await store.add(stored);
    total += stored.length;
    process.stdout.write(`${entry.doc}: ${stored.length} chunks (${skipped} skipped so far)\n`);
  }
  process.stdout.write(`Indexed ${total} new chunks (${skipped} skipped, model ${config.ragEmbeddingModel}, dim ${config.ragEmbedDim}) → ${path.join(config.ragDataRoot, "index.json")}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`Ingestion failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
