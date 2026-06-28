import type { AiUsage, ChatMessage } from "@internal/shared";
import { parseSseData } from "../sse.js";

type GeminiPart = { text: string };
type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };
type GeminiBody = {
  contents: GeminiContent[];
  systemInstruction?: { parts: GeminiPart[] };
};

/**
 * Convert our `ChatMessage[]` (system/user/assistant) into the Gemini request
 * shape: `system` messages become a single `systemInstruction`, `assistant`
 * maps to the Gemini `model` role, and `user` stays `user`.
 */
export function toGeminiBody(messages: ChatMessage[]): GeminiBody {
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
  return body;
}

/**
 * Extract incremental text from one Gemini streaming `data:` payload
 * (`{candidates:[{content:{parts:[{text}]}}]}`). Returns "" for malformed JSON.
 */
export function extractGeminiToken(data: string): string {
  if (data === "") {
    return "";
  }
  try {
    const json = JSON.parse(data) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const parts = json.candidates?.[0]?.content?.parts ?? [];
    return parts.map((part) => part.text ?? "").join("");
  } catch {
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
  signal: AbortSignal
): AsyncGenerator<string, AiUsage | undefined> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    remoteModelId
  )}:streamGenerateContent?alt=sse`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(toGeminiBody(messages)),
    signal
  });
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    throw new Error(`Gemini returned ${response.status}: ${text || "no response body"}`);
  }
  let usage: AiUsage | undefined;
  for await (const data of parseSseData(response.body)) {
    const chunkUsage = extractGeminiUsage(data);
    if (chunkUsage) {
      usage = chunkUsage;
    }
    const token = extractGeminiToken(data);
    if (token) {
      yield token;
    }
  }
  return usage;
}
