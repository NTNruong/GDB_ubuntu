import type { ApiConfig } from "../config.js";

/**
 * Embedding "task type": query vs document. `gemini-embedding-001` uses this to
 * produce asymmetric vectors tuned for retrieval (a query embedding matches the
 * document embeddings it should retrieve). Newer models may ignore/reject it —
 * `useTaskType:false` omits it.
 */
export type EmbedKind = "document" | "query";

/** One shape, multiple impls (real Gemini call vs a stub in tests). */
export interface Embedder {
  embed(text: string, kind: EmbedKind): Promise<number[]>;
  /** Identifier persisted with the index so a query uses a matching model. */
  readonly modelId: string;
}

type EmbedContentResponse = { embedding?: { values?: number[] } };

/**
 * Google AI Studio embedding client (`models/{model}:embedContent`). Mirrors the
 * generation backend's auth (`x-goog-api-key`) and error handling in
 * [gemini.ts](./../ai/backends/gemini.ts). Truncates to `outputDimensionality`
 * (Matryoshka) to keep the index small; cosine in the store re-normalizes.
 */
export class GeminiEmbedder implements Embedder {
  readonly modelId: string;

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly dim: number,
    private readonly useTaskType = true
  ) {
    this.modelId = model;
  }

  async embed(text: string, kind: EmbedKind): Promise<number[]> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      this.model
    )}:embedContent`;
    const body: Record<string, unknown> = {
      model: `models/${this.model}`,
      content: { parts: [{ text }] },
      outputDimensionality: this.dim
    };
    if (this.useTaskType) {
      body.taskType = kind === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT";
    }
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Embedding model returned ${response.status}: ${detail || "no response body"}`);
    }
    const json = (await response.json()) as EmbedContentResponse;
    const values = json.embedding?.values;
    if (!values || values.length === 0) {
      throw new Error("Embedding response had no values");
    }
    return values;
  }
}

/** Build a Gemini embedder from the resolved key + RAG config, or null if no key. */
export function makeGeminiEmbedder(apiKey: string, config: ApiConfig): GeminiEmbedder | null {
  if (!apiKey) {
    return null;
  }
  return new GeminiEmbedder(apiKey, config.ragEmbeddingModel, config.ragEmbedDim);
}
