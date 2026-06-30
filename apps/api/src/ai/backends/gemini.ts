import type { AiUsage, ChatMessage } from "@internal/shared";
import { parseSseData } from "../sse.js";

type GeminiPart = { text: string };
type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };
type GeminiBody = {
  contents: GeminiContent[];
  systemInstruction?: { parts: GeminiPart[] };
  generationConfig?: { thinkingConfig?: { includeThoughts?: boolean } };
};

/** One streamed Gemini part split into its text and whether it is reasoning (`thought:true`). */
export type GeminiStreamPart = { text: string; thought: boolean };

/**
 * Convert our `ChatMessage[]` (system/user/assistant) into the Gemini request
 * shape: `system` messages become a single `systemInstruction`, `assistant`
 * maps to the Gemini `model` role, and `user` stays `user`. When `showThinking`
 * is set we ask the API for thought summaries (`thinkingConfig.includeThoughts`),
 * which arrive as separate parts flagged `thought:true`.
 */
export function toGeminiBody(messages: ChatMessage[], showThinking = false): GeminiBody {
  const systemParts: GeminiPart[] = [];
  const contents: GeminiContent[] = [];
  for (const message of messages) {
    if (message.role === "system") {
      systemParts.push({ text: message.content });
    } else {
      contents.push({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }]
      });
    }
  }
  const body: GeminiBody = { contents };
  if (systemParts.length > 0) {
    body.systemInstruction = { parts: systemParts };
  }
  if (showThinking) {
    body.generationConfig = { thinkingConfig: { includeThoughts: true } };
  }
  return body;
}

/**
 * Extract the parts of one Gemini streaming `data:` payload
 * (`{candidates:[{content:{parts:[{text,thought}]}}]}`), keeping each part's
 * `thought` flag so reasoning can be separated from the answer. `[]` for malformed JSON.
 */
export function extractGeminiParts(data: string): GeminiStreamPart[] {
  if (data === "") {
    return [];
  }
  try {
    const json = JSON.parse(data) as {
      candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
    };
    const parts = json.candidates?.[0]?.content?.parts ?? [];
    return parts
      .filter((part) => typeof part.text === "string" && part.text.length > 0)
      .map((part) => ({ text: part.text as string, thought: part.thought === true }));
  } catch {
    return [];
  }
}

/**
 * Stateful transform of streamed Gemini parts into answer text. Reasoning parts
 * (`thought:true`) are wrapped in a single leading `<think>…</think>` block when
 * `showThinking` is on (so the client's `splitThinking` folds them into a
 * collapsible section) and dropped entirely when off — Gemma still emits thought
 * parts regardless of the request flag, so this prevents them leaking into the answer.
 */
export class GeminiThinkingFilter {
  private inThinking = false;
  constructor(private readonly showThinking: boolean) {}

  push(part: GeminiStreamPart): string {
    if (part.thought) {
      if (!this.showThinking) {
        return "";
      }
      if (!this.inThinking) {
        this.inThinking = true;
        return `<think>${part.text}`;
      }
      return part.text;
    }
    if (this.inThinking) {
      this.inThinking = false;
      return `</think>${part.text}`;
    }
    return part.text;
  }

  /** Close a still-open thinking block at end of stream (answer never followed). */
  flush(): string {
    if (this.inThinking) {
      this.inThinking = false;
      return "</think>";
    }
    return "";
  }
}

/**
 * Extract token accounting from a Gemini chunk's `usageMetadata`
 * (`{promptTokenCount,candidatesTokenCount}`); the final chunk carries the totals.
 */
export function extractGeminiUsage(data: string): AiUsage | null {
  if (data === "") {
    return null;
  }
  try {
    const json = JSON.parse(data) as {
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    const meta = json.usageMetadata;
    if (!meta) {
      return null;
    }
    return {
      promptTokens: meta.promptTokenCount ?? 0,
      completionTokens: meta.candidatesTokenCount ?? 0
    };
  } catch {
    return null;
  }
}

/**
 * Stream a generation from the Google AI Studio API
 * (`models/{model}:streamGenerateContent?alt=sse`), yielding text tokens and
 * returning the final token usage.
 */
export async function* streamGemini(
  apiKey: string,
  remoteModelId: string,
  messages: ChatMessage[],
  signal: AbortSignal,
  showThinking = false
): AsyncGenerator<string, AiUsage | undefined> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    remoteModelId
  )}:streamGenerateContent?alt=sse`;
  // Only real Gemini models need `includeThoughts` to surface reasoning. Gemma served
  // via the same API returns `thought:true` parts regardless of the flag, so we don't
  // send the config for it (avoids any risk of a 400 on a model that doesn't take it) —
  // the filter below still wraps/drops those parts per `showThinking`.
  const requestThoughts = showThinking && /^gemini/i.test(remoteModelId);
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(toGeminiBody(messages, requestThoughts)),
    signal
  });
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    throw new Error(`Gemini returned ${response.status}: ${text || "no response body"}`);
  }
  let usage: AiUsage | undefined;
  const filter = new GeminiThinkingFilter(showThinking);
  for await (const data of parseSseData(response.body)) {
    const chunkUsage = extractGeminiUsage(data);
    if (chunkUsage) {
      usage = chunkUsage;
    }
    for (const part of extractGeminiParts(data)) {
      const token = filter.push(part);
      if (token) {
        yield token;
      }
    }
  }
  const tail = filter.flush();
  if (tail) {
    yield tail;
  }
  return usage;
}
