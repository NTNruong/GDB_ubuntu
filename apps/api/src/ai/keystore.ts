import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AiKeyInfoResponse } from "@internal/shared";

/**
 * Per-user secret store for the Google API key. The key must be decryptable to
 * use (sent as the outbound `x-goog-api-key` header), so it is encrypted with
 * AES-256-GCM (symmetric) rather than hashed. The encryption key is derived from
 * a server secret (`config.aiKeySecret`, defaulting to SESSION_SECRET); a stolen
 * `gemini-key.enc` is useless without that secret. The plaintext key is never
 * returned to the client — only `{ hasKey, last4 }`.
 */
const ALGO = "aes-256-gcm";

function deriveKey(secret: string): Buffer {
  return scryptSync(secret, "gdb-ai-keystore-v1", 32);
}

function keyFile(userDir: string): string {
  return path.join(userDir, "gemini-key.enc");
}

export function encryptSecret(secret: string, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, deriveKey(secret), iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return JSON.stringify({
    v: 1,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64")
  });
}

export function decryptSecret(secret: string, blob: string): string {
  const { iv, tag, data } = JSON.parse(blob) as { iv: string; tag: string; data: string };
  const decipher = createDecipheriv(ALGO, deriveKey(secret), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}

export async function storeUserKey(userDir: string, secret: string, apiKey: string): Promise<void> {
  await mkdir(userDir, { recursive: true, mode: 0o700 });
  const file = keyFile(userDir);
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, encryptSecret(secret, apiKey), { mode: 0o600 });
  await rename(tmp, file);
}

/** Decrypt the stored key, or null if absent / unreadable (e.g. secret changed). */
export async function loadUserKey(userDir: string, secret: string): Promise<string | null> {
  let blob: string;
  try {
    blob = await readFile(keyFile(userDir), "utf8");
  } catch {
    return null;
  }
  try {
    return decryptSecret(secret, blob);
  } catch {
    return null;
  }
}

export async function deleteUserKey(userDir: string): Promise<void> {
  await rm(keyFile(userDir), { force: true });
}

export async function userKeyInfo(userDir: string, secret: string): Promise<AiKeyInfoResponse> {
  const key = await loadUserKey(userDir, secret);
  return key ? { hasKey: true, last4: key.slice(-4) } : { hasKey: false };
}
