import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/** One retrievable unit of the corpus (a heading-scoped chunk of a document). */
export type RagChunk = {
  /** Stable id, e.g. `${doc}#${headingPath}#${ordinal}`. */
  id: string;
  /** Short document label, e.g. "CMSIS-Core" or "ESP-IDF: GPIO". */
  doc: string;
  /** Breadcrumb of headings the chunk lives under, e.g. "GPIO > API Reference". */
  headingPath: string;
  /** Canonical source URL for citation. */
  sourceUrl: string;
  /** The chunk text. */
  text: string;
};

/** A chunk plus its embedding vector (what the store persists). */
export type StoredChunk = RagChunk & { embedding: number[] };

/** A search result: the chunk metadata/text plus its similarity score. */
export type RagHit = RagChunk & { score: number };

/**
 * Minimal vector-store contract so the pilot's flat JSON store can later be
 * swapped for sqlite-vec / a real ANN index without touching callers.
 */
export interface VectorStore {
  add(chunks: StoredChunk[]): Promise<void>;
  search(embedding: number[], k: number): Promise<RagHit[]>;
  size(): Promise<number>;
  clear(): Promise<void>;
  /** Ids already stored, so an interrupted ingest can resume without re-embedding. */
  existingIds(): Promise<Set<string>>;
}

/** Cosine similarity. Returns 0 if either vector is zero-length/mismatched. */
export function cosineSim(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i += 1) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  if (na === 0 || nb === 0) {
    return 0;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

type IndexFile = { model: string; dim: number; chunks: StoredChunk[] };

/**
 * Flat, in-memory, JSON-backed vector store. Loads the whole index on first use
 * and does a brute-force cosine scan — fine for a pilot corpus (≤ tens of
 * thousands of chunks). Persisted atomically (tmp + rename) like the keystore.
 */
export class JsonVectorStore implements VectorStore {
  private chunks: StoredChunk[] | null = null;

  constructor(
    private readonly file: string,
    private readonly model: string,
    private readonly dim: number
  ) {}

  private async load(): Promise<StoredChunk[]> {
    if (this.chunks) {
      return this.chunks;
    }
    try {
      const raw = await readFile(this.file, "utf8");
      const parsed = JSON.parse(raw) as IndexFile;
      this.chunks = parsed.chunks ?? [];
    } catch {
      this.chunks = [];
    }
    return this.chunks;
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const body: IndexFile = { model: this.model, dim: this.dim, chunks: this.chunks ?? [] };
    const tmp = `${this.file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(body), { mode: 0o600 });
    await rename(tmp, this.file);
  }

  async add(incoming: StoredChunk[]): Promise<void> {
    const chunks = await this.load();
    const byId = new Map(chunks.map((chunk) => [chunk.id, chunk]));
    for (const chunk of incoming) {
      byId.set(chunk.id, chunk);
    }
    this.chunks = [...byId.values()];
    await this.persist();
  }

  async search(embedding: number[], k: number): Promise<RagHit[]> {
    const chunks = await this.load();
    const scored = chunks.map((chunk) => ({
      doc: chunk.doc,
      id: chunk.id,
      headingPath: chunk.headingPath,
      sourceUrl: chunk.sourceUrl,
      text: chunk.text,
      score: cosineSim(embedding, chunk.embedding)
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, Math.max(0, k));
  }

  async size(): Promise<number> {
    return (await this.load()).length;
  }

  async existingIds(): Promise<Set<string>> {
    return new Set((await this.load()).map((chunk) => chunk.id));
  }

  async clear(): Promise<void> {
    this.chunks = [];
    await this.persist();
  }
}
