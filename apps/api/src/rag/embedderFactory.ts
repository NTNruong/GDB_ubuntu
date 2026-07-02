import path from "node:path";
import type { ApiConfig } from "../config.js";
import type { Embedder } from "./embedding.js";
import { makeGeminiEmbedder } from "./embedding.js";
import { LocalEmbedder } from "./localEmbedder.js";

/** The embedding model/dim actually in effect for the configured backend. */
export function activeEmbedModelDim(config: ApiConfig): { model: string; dim: number } {
  return config.ragEmbedBackend === "local"
    ? { model: config.localEmbedModel, dim: config.localEmbedDim }
    : { model: config.ragEmbeddingModel, dim: config.ragEmbedDim };
}

function sanitizeModelId(model: string): string {
  return model.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/**
 * One index file per (model, dim) pair (not a single hardcoded `index.json`) so
 * switching `RAG_EMBED_BACKEND` never mixes incompatible vectors in one store, and
 * the gemini vs local A/B (C1 eval) can run without re-ingesting either.
 */
export function indexFilePath(config: ApiConfig): string {
  const { model, dim } = activeEmbedModelDim(config);
  return path.join(config.ragDataRoot, `index_${sanitizeModelId(model)}_${dim}.json`);
}

/**
 * Build the embedder for the active `RAG_EMBED_BACKEND`. `geminiKey` is the caller's
 * already-resolved per-request/server key (ignored for `local`, which needs no Google
 * key). Returns null only when `gemini` is selected and no key is available — callers
 * already treat that as the degrade-without-docs case.
 */
export function makeEmbedder(config: ApiConfig, geminiKey: string, maxWaitMs = 10_000): Embedder | null {
  if (config.ragEmbedBackend === "local") {
    return new LocalEmbedder(config.localEmbedBaseUrl, config.localEmbedModel, config.localEmbedApiKey);
  }
  return makeGeminiEmbedder(geminiKey, config, maxWaitMs);
}
