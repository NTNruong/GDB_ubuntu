import type { AiReasoningEffort, AiUsage, ChatMessage } from "@internal/shared";
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
 * Extract the incremental *reasoning* text from one streaming chunk
 * (`{choices:[{delta:{reasoning_content}}]}`) — the field reasoning models (DeepSeek-R1,
 * Qwen3, …) use for chain-of-thought. Returns "" otherwise. The caller wraps a run of
 * these in `<think>…</think>` so the client's `splitThinking` renders them collapsed.
 */
export function extractLlamaReasoning(data: string): string {
  if (data === "[DONE]" || data === "") {
    return "";
  }
  try {
    const json = JSON.parse(data) as { choices?: { delta?: { reasoning_content?: string } }[] };
    return json.choices?.[0]?.delta?.reasoning_content ?? "";
  } catch {
    return "";
  }
}

/**
 * Extract token accounting from the final `stream_options.include_usage` chunk
 * (`{usage:{prompt_tokens,completion_tokens}}`, with empty `choices`). Returns
 * null for any chunk without a `usage` field.
 */
export function extractLlamaUsage(data: string): AiUsage | null {
  if (data === "[DONE]" || data === "") {
    return null;
  }
  try {
    const json = JSON.parse(data) as { usage?: { prompt_tokens?: number; completion_tokens?: number } };
    if (!json.usage) {
      return null;
    }
    return {
      promptTokens: json.usage.prompt_tokens ?? 0,
      completionTokens: json.usage.completion_tokens ?? 0
    };
  } catch {
    return null;
  }
}

/** Cache the model's context window per server so we only hit `/props` once. */
const contextSizeCache = new Map<string, number>();

async function fetchContextSize(baseUrl: string, apiKey: string): Promise<number | undefined> {
  const base = baseUrl.replace(/\/$/, "");
  const cached = contextSizeCache.get(base);
  if (cached !== undefined) {
    return cached;
  }
  try {
    const headers: Record<string, string> = {};
    if (apiKey) {
      headers.authorization = `Bearer ${apiKey}`;
    }
    const response = await fetch(`${base}/props`, { headers });
    if (!response.ok) {
      return undefined;
    }
    const json = (await response.json()) as {
      default_generation_settings?: { n_ctx?: number };
      n_ctx?: number;
    };
    const size = json.default_generation_settings?.n_ctx ?? json.n_ctx;
    if (typeof size === "number") {
      contextSizeCache.set(base, size);
      return size;
    }
  } catch {
    // best-effort: a missing/old /props just means the meter shows no context size
  }
  return undefined;
}

/**
 * Stream a chat completion from a local llama.cpp server (OpenAI-compatible
 * `/v1/chat/completions`, `stream: true`), yielding text tokens as they arrive.
 * When `apiKey` is set it is sent as `Authorization: Bearer …` — this matches
 * llama-server's `--api-key`, which protects the model even when its port is
 * reachable over the tailnet (the host-loopback path is blocked under rootless
 * Docker, so the server must be reached via the host's real IP).
 */
export async function* streamLlama(
  baseUrl: string,
  remoteModelId: string,
  messages: ChatMessage[],
  signal: AbortSignal,
  apiKey = "",
  reasoningEffort: AiReasoningEffort = "off"
): AsyncGenerator<string, AiUsage | undefined> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  }
  const body: Record<string, unknown> = {
    model: remoteModelId,
    messages,
    stream: true,
    stream_options: { include_usage: true }
  };
  // Harmless on builds that don't support it; drives reasoning depth where they do.
  if (reasoningEffort !== "off") {
    body.reasoning_effort = reasoningEffort;
  }
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal
  });
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    throw new Error(`llama.cpp returned ${response.status}: ${text || "no response body"}`);
  }
  let usage: AiUsage | undefined;
  // Reasoning arrives in `reasoning_content` deltas before the answer's `content`.
  // Wrap a run of them in `<think>…</think>` so the client's splitThinking can fold it.
  let thinkOpen = false;
  for await (const data of parseSseData(response.body)) {
    if (data === "[DONE]") {
      break;
    }
    const chunkUsage = extractLlamaUsage(data);
    if (chunkUsage) {
      usage = chunkUsage;
    }
    const reasoning = extractLlamaReasoning(data);
    if (reasoning) {
      if (!thinkOpen) {
        thinkOpen = true;
        yield "<think>";
      }
      yield reasoning;
    }
    const token = extractLlamaToken(data);
    if (token) {
      if (thinkOpen) {
        thinkOpen = false;
        yield "</think>";
      }
      yield token;
    }
  }
  // Stream ended while still inside reasoning (no answer content): close the block.
  if (thinkOpen) {
    yield "</think>";
  }
  if (usage) {
    usage.contextSize = await fetchContextSize(baseUrl, apiKey);
  }
  return usage;
}
