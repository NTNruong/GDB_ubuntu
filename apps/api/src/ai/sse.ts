/**
 * Parse a Server-Sent-Events byte stream into successive `data:` payload
 * strings. Both the OpenAI-compatible (llama.cpp) and Gemini streaming APIs emit
 * one JSON object per `data:` line, so line-based extraction is sufficient. The
 * caller JSON-parses each payload with a backend-specific extractor.
 */
export async function* parseSseData(body: AsyncIterable<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).replace(/\r$/, "");
      buffer = buffer.slice(nl + 1);
      if (line.startsWith("data:")) {
        yield line.slice(5).trim();
      }
    }
  }
  buffer += decoder.decode();
  const last = buffer.replace(/\r$/, "");
  if (last.startsWith("data:")) {
    yield last.slice(5).trim();
  }
}
