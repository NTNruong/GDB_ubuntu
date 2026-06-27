import type { ChatMessage } from "@internal/shared";
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
 * Stream a generation from the Google AI Studio API
 * (`models/{model}:streamGenerateContent?alt=sse`), yielding text tokens.
 */
export async function* streamGemini(
  apiKey: string,
  remoteModelId: string,
  messages: ChatMessage[],
  signal: AbortSignal
): AsyncGenerator<string> {
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
  for await (const data of parseSseData(response.body)) {
    const token = extractGeminiToken(data);
    if (token) {
      yield token;
    }
  }
}
