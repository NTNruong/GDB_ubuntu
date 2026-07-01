import type { AiUsage } from "@internal/shared";

/**
 * Gemini function-calling for the agent loop. Unlike {@link streamGemini} (plain
 * text streaming) this drives `models/{m}:generateContent` (non-stream) with tool
 * declarations and returns the model's `functionCall`s and/or final `text`, so the
 * agent loop can execute tools and feed the results back. Only real Gemini models
 * (e.g. `gemini-flash-latest`) support this — Gemma served via the same API does not.
 */

/** One tool the model may call (JSON-schema `parameters`, OpenAPI subset). */
export type ToolDeclaration = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type GeminiFunctionCall = { name: string; args: Record<string, unknown> };

/** A part in the agent conversation: user/model text, a call, or a tool result. */
export type GeminiToolPart =
  | { text: string }
  | { functionCall: GeminiFunctionCall }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

export type GeminiToolContent = { role: "user" | "model"; parts: GeminiToolPart[] };

export type GeminiTurn = {
  functionCalls: GeminiFunctionCall[];
  text: string;
  usage?: AiUsage;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** One agent turn: send the running conversation + tools, get calls and/or text back. */
export async function geminiToolTurn(
  apiKey: string,
  remoteModelId: string,
  systemInstruction: string,
  contents: GeminiToolContent[],
  tools: ToolDeclaration[],
  signal: AbortSignal,
  maxRetries = 3
): Promise<GeminiTurn> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    remoteModelId
  )}:generateContent`;
  const body: Record<string, unknown> = {
    contents,
    toolConfig: { functionCallingConfig: { mode: "auto" } }
  };
  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }
  if (tools.length > 0) {
    body.tools = [{ functionDeclarations: tools }];
  }

  for (let attempt = 1; ; attempt++) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
      signal
    });
    if (response.ok) {
      const json = (await response.json()) as {
        candidates?: { content?: { parts?: GeminiToolPart[] } }[];
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      };
      const parts = json.candidates?.[0]?.content?.parts ?? [];
      const functionCalls: GeminiFunctionCall[] = [];
      let text = "";
      for (const part of parts) {
        if ("functionCall" in part && part.functionCall) {
          functionCalls.push({ name: part.functionCall.name, args: part.functionCall.args ?? {} });
        } else if ("text" in part && typeof part.text === "string") {
          text += part.text;
        }
      }
      const meta = json.usageMetadata;
      const usage: AiUsage | undefined = meta
        ? { promptTokens: meta.promptTokenCount ?? 0, completionTokens: meta.candidatesTokenCount ?? 0 }
        : undefined;
      return { functionCalls, text, usage };
    }
    const detail = await response.text().catch(() => "");
    if ((response.status === 429 || response.status === 503) && attempt <= maxRetries) {
      await sleep(Math.min(1000 * 2 ** (attempt - 1), 20_000));
      continue;
    }
    throw new Error(`Gemini returned ${response.status}: ${detail || "no response body"}`);
  }
}
