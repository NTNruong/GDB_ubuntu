import type { EmbedKind, Embedder } from "./embedding.js";

/**
 * Retrieval instruction prepended to queries (Qwen3-Embedding is instruction-tuned;
 * documents are embedded plain so retrieval stays asymmetric, mirroring GeminiEmbedder).
 */
const QWEN_QUERY_INSTRUCTION =
  "Given a programming or embedded-systems question, retrieve documentation passages that answer it";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

type EmbeddingsResponse = { data?: { embedding?: number[] }[] };

/**
 * OpenAI-compatible `/v1/embeddings` client for a local llama.cpp server (Qwen3-Embedding
 * on the host GPU — no Google quota, so no rate limiter here). A trimmed copy of
 * `GeminiEmbedder`'s retry loop (no `Retry-After` parsing needed for a local server).
 */
export class LocalEmbedder implements Embedder {
  readonly modelId: string;

  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly apiKey: string,
    private readonly maxRetries = 5
  ) {
    this.modelId = model;
  }

  async embed(text: string, kind: EmbedKind): Promise<number[]> {
    const input = kind === "query" ? `Instruct: ${QWEN_QUERY_INSTRUCTION}\nQuery: ${text}` : text;
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey !== "") {
      headers.authorization = `Bearer ${this.apiKey}`;
    }
    for (let attempt = 1; ; attempt++) {
      const response = await fetch(`${this.baseUrl}/v1/embeddings`, {
        method: "POST",
        headers,
        body: JSON.stringify({ model: this.model, input })
      });
      if (response.ok) {
        const json = (await response.json()) as EmbeddingsResponse;
        const values = json.data?.[0]?.embedding;
        if (!values || values.length === 0) {
          throw new Error("Local embedding response had no values");
        }
        return values;
      }
      if ((response.status === 429 || response.status >= 500) && attempt <= this.maxRetries) {
        await sleep(Math.min(1000 * 2 ** (attempt - 1), 30_000));
        continue;
      }
      const detail = await response.text().catch(() => "");
      throw new Error(`Local embedding server returned ${response.status}: ${detail || "no response body"}`);
    }
  }
}
