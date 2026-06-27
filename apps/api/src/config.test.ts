import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readConfig } from "./config.js";

describe("readConfig aiKeySecret fallback (ISSUE-073)", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    delete process.env.AI_KEY_SECRET;
    delete process.env.SESSION_SECRET;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("falls back to SESSION_SECRET when AI_KEY_SECRET is an empty string", () => {
    // compose passes AI_KEY_SECRET="" when it is unset in .env — must not disable
    // the per-user key store; it should fall through to SESSION_SECRET.
    process.env.AI_KEY_SECRET = "";
    process.env.SESSION_SECRET = "session-secret";
    expect(readConfig().aiKeySecret).toBe("session-secret");
  });

  it("prefers an explicit AI_KEY_SECRET over SESSION_SECRET", () => {
    process.env.AI_KEY_SECRET = "explicit-ai-secret";
    process.env.SESSION_SECRET = "session-secret";
    expect(readConfig().aiKeySecret).toBe("explicit-ai-secret");
  });

  it("is empty only when both secrets are absent", () => {
    process.env.AI_KEY_SECRET = "";
    process.env.SESSION_SECRET = "";
    expect(readConfig().aiKeySecret).toBe("");
  });
});
