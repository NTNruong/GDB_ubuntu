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

async function main(): Promise<void> {
  const config = readConfig();
  if (!config.geminiApiKey) {
    throw new Error("GEMINI_API_KEY is required to embed the corpus");
  }
  const manifestPath = path.resolve(process.argv[2] ?? "corpus/corpus.manifest.json");
  const corpusDir = path.dirname(manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;

  const embedder = new GeminiEmbedder(config.geminiApiKey, config.ragEmbeddingModel, config.ragEmbedDim);
  const store = new JsonVectorStore(
    path.join(config.ragDataRoot, "index.json"),
    config.ragEmbeddingModel,
    config.ragEmbedDim
  );

  let total = 0;
  for (const entry of manifest.entries) {
    const markdown = await readFile(path.join(corpusDir, entry.file), "utf8");
    const chunks = chunkMarkdown(markdown);
    const stored: StoredChunk[] = [];
    for (const [index, chunk] of chunks.entries()) {
      const embedding = await embedder.embed(chunk.text, "document");
      stored.push({
        id: `${slug(entry.doc)}#${index}`,
        doc: entry.doc,
        headingPath: chunk.headingPath,
        sourceUrl: entry.sourceUrl,
        text: chunk.text,
        embedding
      });
    }
    await store.add(stored);
    total += stored.length;
    process.stdout.write(`${entry.doc}: ${stored.length} chunks\n`);
  }
  process.stdout.write(`Indexed ${total} chunks (model ${config.ragEmbeddingModel}, dim ${config.ragEmbedDim}) → ${path.join(config.ragDataRoot, "index.json")}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`Ingestion failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
