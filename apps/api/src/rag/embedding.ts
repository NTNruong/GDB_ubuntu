import type { ApiConfig } from "../config.js";

/**
 * Embedding "task type": query vs document, for asymmetric retrieval (a query
 * embedding matches the document embeddings it should retrieve). Older models
 * (`gemini-embedding-001`) take this via the `taskType` field; `gemini-embedding-2`
 * rejects `taskType` and instead expects the task as a prompt instruction — the
 * embedder picks the right mechanism per model.
 */
export type EmbedKind = "document" | "query";

/**
 * `gemini-embedding-2` (and its preview) do NOT accept the `taskType` field — you
 * express the retrieval task as a prompt instruction instead. Older models keep
 * using `taskType`.
 */
function modelSupportsTaskType(model: string): boolean {
  return !model.startsWith("gemini-embedding-2");
}

/** One shape, multiple impls (real Gemini call vs a stub in tests). */
export interface Embedder {
  embed(text: string, kind: EmbedKind): Promise<number[]>;
  /** Identifier persisted with the index so a query uses a matching model. */
  readonly modelId: string;
}

type EmbedContentResponse = { embedding?: { values?: number[] } };

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * How long to wait before retrying a 429/503. Honors Google's `Retry-After`
 * header or the `retryDelay` in the error body (e.g. "17s"), else falls back to
 * capped exponential backoff so a rate-limit storm self-corrects.
 */
function retryDelayMs(response: Response, body: string, attempt: number): number {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number.parseFloat(header);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, 60_000);
    }
  }
  const match = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(body);
  if (match?.[1]) {
    return Math.min(Number.parseFloat(match[1]) * 1000, 60_000);
  }
  return Math.min(1000 * 2 ** (attempt - 1), 30_000);
}

/**
 * Google AI Studio embedding client (`models/{model}:embedContent`). Mirrors the
 * generation backend's auth (`x-goog-api-key`) and error handling in
 * [gemini.ts](./../ai/backends/gemini.ts). Truncates to `outputDimensionality`
 * (Matryoshka) to keep the index small; cosine in the store re-normalizes.
 */
export class GeminiEmbedder implements Embedder {
  readonly modelId: string;

  /** Whether to send the `taskType` field (older models) vs a prompt instruction (v2). */
  private readonly useTaskType: boolean;

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly dim: number,
    /** Override taskType usage; defaults to what the model supports. */
    useTaskType?: boolean,
    /** Extra attempts on 429/503 before giving up (rate-limit resilience, ISSUE-097). */
    private readonly maxRetries = 5
  ) {
    this.modelId = model;
    this.useTaskType = useTaskType ?? modelSupportsTaskType(model);
  }

  async embed(text: string, kind: EmbedKind): Promise<number[]> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      this.model
    )}:embedContent`;
    // taskType models: send the field, embed text as-is. Instruction models (v2):
    // no taskType — prepend the retrieval task to the query so it stays asymmetric
    // with plainly-embedded documents.
    const input = !this.useTaskType && kind === "query" ? `task: search result | query: ${text}` : text;
    const body: Record<string, unknown> = {
      model: `models/${this.model}`,
      content: { parts: [{ text: input }] },
      outputDimensionality: this.dim
    };
    if (this.useTaskType) {
      body.taskType = kind === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT";
    }
    for (let attempt = 1; ; attempt++) {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify(body)
      });
      if (response.ok) {
        const json = (await response.json()) as EmbedContentResponse;
        const values = json.embedding?.values;
        if (!values || values.length === 0) {
          throw new Error("Embedding response had no values");
        }
        return values;
      }
      const detail = await response.text().catch(() => "");
      // 429 = rate-limit (RESOURCE_EXHAUSTED), 503 = transient overload → back off
      // and retry so a burst of ingest calls doesn't fail the whole job (ISSUE-097).
      if ((response.status === 429 || response.status === 503) && attempt <= this.maxRetries) {
        await sleep(retryDelayMs(response, detail, attempt));
        continue;
      }
      throw new Error(`Embedding model returned ${response.status}: ${detail || "no response body"}`);
    }
  }
}

/** Build a Gemini embedder from the resolved key + RAG config, or null if no key. */
export function makeGeminiEmbedder(apiKey: string, config: ApiConfig): GeminiEmbedder | null {
  if (!apiKey) {
    return null;
  }
  return new GeminiEmbedder(apiKey, config.ragEmbeddingModel, config.ragEmbedDim);
}
