import type { Embedder } from "./embedding.js";
import type { RagHit, VectorStore } from "./store.js";

/** Default number of chunks to retrieve per query. */
export const DEFAULT_TOP_K = 5;

/**
 * Embed the query then return the top-k most similar corpus chunks. The query is
 * embedded with `kind:"query"` so retrieval stays asymmetric (query↔document).
 */
export async function searchDocs(
  store: VectorStore,
  embedder: Embedder,
  query: string,
  k: number = DEFAULT_TOP_K
): Promise<RagHit[]> {
  const trimmed = query.trim();
  if (trimmed === "") {
    return [];
  }
  const queryVec = await embedder.embed(trimmed, "query");
  return store.search(queryVec, k);
}

/**
 * Render retrieved chunks as a system-prompt context block with numbered
 * citations, so the model can ground its answer and cite `[n]` sources.
 * Returns "" when there are no hits (caller then skips injection).
 */
export function formatDocContext(hits: RagHit[]): string {
  if (hits.length === 0) {
    return "";
  }
  const blocks = hits.map((hit, index) => {
    const heading = hit.headingPath ? ` — ${hit.headingPath}` : "";
    return [
      `[${index + 1}] ${hit.doc}${heading}`,
      `Source: ${hit.sourceUrl}`,
      hit.text.trim()
    ].join("\n");
  });
  return [
    "Reference documentation (retrieved for this question). Ground your answer in",
    "these excerpts and cite them inline as [n]; if they don't cover the question,",
    "say so instead of inventing details.",
    "",
    blocks.join("\n\n---\n\n")
  ].join("\n");
}
