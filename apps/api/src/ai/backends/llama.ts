import type { ChatMessage } from "@internal/shared";
import { parseSseData } from "../sse.js";

/**
 * Extract the incremental text from one OpenAI-compatible streaming `data:`
 * payload (`{choices:[{delta:{content}}]}`). Returns "" for keep-alives, the
 * `[DONE]` sentinel, or malformed JSON — the caller treats "" as "no token".
 */
export function extractLlamaToken(data: string): string {
  if (data === "[DONE]" || data === "") {
    return "";
  }
  try {
    const json = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
    return json.choices?.[0]?.delta?.content ?? "";
  } catch {
    return "";
  }
}

/**
 * Stream a chat completion from a local llama.cpp server (OpenAI-compatible
 * `/v1/chat/completions`, `stream: true`), yielding text tokens as they arrive.
 */
export async function* streamLlama(
  baseUrl: string,
  remoteModelId: string,
  messages: ChatMessage[],
  signal: AbortSignal
): AsyncGenerator<string> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: remoteModelId, messages, stream: true }),
    signal
  });
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    throw new Error(`llama.cpp returned ${response.status}: ${text || "no response body"}`);
  }
  for await (const data of parseSseData(response.body)) {
    if (data === "[DONE]") {
      break;
    }
    const token = extractLlamaToken(data);
    if (token) {
      yield token;
    }
  }
}
