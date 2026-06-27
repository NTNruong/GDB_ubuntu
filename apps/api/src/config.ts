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
  /** Server-wide Google AI Studio API key fallback (per-user keys take precedence). */
  geminiApiKey: string;
  /** Root dir holding one subdir per user for AI chat threads (separate from userHomesRoot). */
  aiDataRoot: string;
  /** Secret used to encrypt per-user API keys at rest. Falls back to SESSION_SECRET. */
  aiKeySecret: string;
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
    geminiApiKey: process.env.GEMINI_API_KEY ?? "",
    aiDataRoot: process.env.AI_DATA_ROOT ?? path.join(tmpdir(), "gdb-ubuntu-ai-data"),
    aiKeySecret: process.env.AI_KEY_SECRET ?? process.env.SESSION_SECRET ?? ""
  };
}
