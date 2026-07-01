import { tmpdir } from "node:os";
import path from "node:path";

export type ApiConfig = {
  host: string;
  port: number;
  runnerBaseUrl: string;
  runnerWsUrl: string;
  /** Root dir holding one subdirectory per user (the explorer's storage). */
  userHomesRoot: string;
  /** users.json (bcrypt-hashed accounts). Defaults inside userHomesRoot. */
  usersFile: string;
  /** JWT/cookie signing secret. Empty → ephemeral random (sessions reset on restart). */
  sessionSecret: string;
  /** Set the session cookie `Secure` flag (enable behind HTTPS). */
  sessionCookieSecure: boolean;
  /** Enable the local llama.cpp backend for the AI assistant (Phase 3). */
  aiEnabled: boolean;
  /** Base URL of the host llama.cpp server (OpenAI-compatible). */
  llamaBaseUrl: string;
  /** Bearer token for the llama.cpp server (`--api-key`); "" = no auth. */
  llamaApiKey: string;
  /** Server-wide Google AI Studio API key fallback (per-user keys take precedence). */
  geminiApiKey: string;
  /** Root dir holding one subdir per user for AI chat threads (separate from userHomesRoot). */
  aiDataRoot: string;
  /** Secret used to encrypt per-user API keys at rest. Falls back to SESSION_SECRET. */
  aiKeySecret: string;
  /** Wall-clock cap (ms) on a single Antigravity agent run before we stop + cancel. */
  antigravityMaxMs: number;
  /** Root dir holding the RAG vector store (corpus index), separate from chat data. */
  ragDataRoot: string;
  /**
   * Google embedding model id used by the RAG pipeline. Default `gemini-embedding-2`
   * (multimodal, 3072-dim native, Matryoshka down to `ragEmbedDim`). Set
   * `gemini-embedding-001` to fall back to the older GA model.
   */
  ragEmbeddingModel: string;
  /** Output embedding dimensionality (Matryoshka truncation). Keeps the index compact. */
  ragEmbedDim: number;
  /** Proactive embedding quota caps (free-tier defaults at ~90% of Google's limits). */
  ragEmbedRpm: number;
  ragEmbedTpm: number;
  ragEmbedRpd: number;
};

export function readConfig(): ApiConfig {
  const userHomesRoot = process.env.USER_HOMES_ROOT ?? path.join(tmpdir(), "gdb-ubuntu-user-homes");
  return {
    host: process.env.HOST ?? "0.0.0.0",
    port: Number.parseInt(process.env.PORT ?? "4000", 10),
    runnerBaseUrl: process.env.RUNNER_BASE_URL ?? "http://localhost:4001",
    runnerWsUrl: process.env.RUNNER_WS_URL ?? "ws://localhost:4001",
    userHomesRoot,
    usersFile: process.env.USERS_FILE ?? path.join(userHomesRoot, "users.json"),
    sessionSecret: process.env.SESSION_SECRET ?? "",
    sessionCookieSecure: process.env.SESSION_COOKIE_SECURE === "1",
    aiEnabled: process.env.AI_ENABLED !== "0",
    llamaBaseUrl: process.env.LLAMA_BASE_URL ?? "http://localhost:8000",
    llamaApiKey: process.env.LLAMA_API_KEY ?? "",
    geminiApiKey: process.env.GEMINI_API_KEY ?? "",
    aiDataRoot: process.env.AI_DATA_ROOT ?? path.join(tmpdir(), "gdb-ubuntu-ai-data"),
    // `||` (not `??`) so an empty AI_KEY_SECRET — which compose passes as "" when
    // unset in .env — still falls back to SESSION_SECRET instead of disabling the
    // per-user key store with a "" secret (ISSUE-073).
    aiKeySecret: process.env.AI_KEY_SECRET || process.env.SESSION_SECRET || "",
    antigravityMaxMs: Number.parseInt(process.env.ANTIGRAVITY_MAX_MS ?? "180000", 10),
    ragDataRoot: process.env.RAG_DATA_ROOT ?? path.join(tmpdir(), "gdb-ubuntu-rag-data"),
    ragEmbeddingModel: process.env.RAG_EMBEDDING_MODEL ?? "gemini-embedding-2",
    ragEmbedDim: Number.parseInt(process.env.RAG_EMBED_DIM ?? "768", 10),
    // Free tier is ~100 RPM / 30K TPM / 1K RPD per embedding model; default to ~90% so
    // the limiter leaves headroom for Google's own accounting slop (band-aid, ISSUE-097).
    ragEmbedRpm: Number.parseInt(process.env.RAG_EMBED_RPM ?? "90", 10),
    ragEmbedTpm: Number.parseInt(process.env.RAG_EMBED_TPM ?? "27000", 10),
    ragEmbedRpd: Number.parseInt(process.env.RAG_EMBED_RPD ?? "900", 10)
  };
}
