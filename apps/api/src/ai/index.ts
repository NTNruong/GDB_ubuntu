import { AI_MODELS, type AiModel, type ChatMessage } from "@internal/shared";
import type { ApiConfig } from "../config.js";
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
    if (model.backend === "gemini") {
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
