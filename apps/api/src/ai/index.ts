import { AI_MODELS, type AiModel, type AiStreamEvent, type ChatMessage } from "@internal/shared";
import type { ApiConfig } from "../config.js";
import { streamAntigravity, type AgentRunResult } from "./backends/antigravity.js";
import { streamGemini } from "./backends/gemini.js";
import { streamLlama } from "./backends/llama.js";

/**
 * The subset of {@link AI_MODELS} actually usable for a given user: the local
 * `llama` backend requires `aiEnabled`; the `gemini` backend requires either the
 * user's own key (`hasUserGeminiKey`) or the server-wide fallback. A backend with
 * nothing configured is hidden from the picker entirely.
 */
export function enabledModels(config: ApiConfig, hasUserGeminiKey = false): AiModel[] {
  return AI_MODELS.filter((model) => {
    if (model.backend === "llama") {
      return config.aiEnabled;
    }
    // `gemini` and `antigravity` both authenticate with the Google API key, so
    // they unlock together (per-user key or the server-wide fallback).
    if (model.backend === "gemini" || model.backend === "antigravity") {
      return hasUserGeminiKey || config.geminiApiKey.length > 0;
    }
    return false;
  });
}

export function findEnabledModel(
  config: ApiConfig,
  id: string,
  hasUserGeminiKey = false
): AiModel | undefined {
  return enabledModels(config, hasUserGeminiKey).find((model) => model.id === id);
}

/**
 * Route a chat request to the right backend; yields text tokens as they arrive.
 * `geminiApiKey` is the resolved effective key (per-user key ?? server fallback).
 */
export function streamChat(
  config: ApiConfig,
  model: AiModel,
  messages: ChatMessage[],
  signal: AbortSignal,
  geminiApiKey: string
): AsyncGenerator<string> {
  if (model.backend === "gemini") {
    return streamGemini(geminiApiKey, model.remoteModelId, messages, signal);
  }
  return streamLlama(config.llamaBaseUrl, model.remoteModelId, messages, signal);
}

/**
 * Run an agentic (Antigravity) model. Unlike {@link streamChat} this yields rich
 * {@link AiStreamEvent}s (answer `token`s + tool/code/image `step`s) and returns
 * the interaction/environment ids so the caller can persist them for multi-turn.
 */
export function streamAgent(
  config: ApiConfig,
  model: AiModel,
  input: string,
  signal: AbortSignal,
  geminiApiKey: string,
  opts: { previousInteractionId?: string; environmentId?: string }
): AsyncGenerator<AiStreamEvent, AgentRunResult> {
  return streamAntigravity(geminiApiKey, model.remoteModelId, input, signal, {
    ...opts,
    maxMs: config.antigravityMaxMs
  });
}
