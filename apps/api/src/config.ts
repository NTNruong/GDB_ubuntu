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
    sessionCookieSecure: process.env.SESSION_COOKIE_SECURE === "1"
  };
}
