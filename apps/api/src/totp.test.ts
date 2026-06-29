import { describe, expect, it } from "vitest";
import { generateSecret, otpauthUri, verifyTotp } from "./totp.js";
import { createHmac } from "node:crypto";

/** Reference TOTP implementation for the current time step, to assert against. */
function reference(secretBase32: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of secretBase32) {
    value = (value << 5) | alphabet.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const digest = createHmac("sha1", Buffer.from(bytes)).update(buf).digest();
  const offset = digest[digest.length - 1]! & 0xf;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    (digest[offset + 1]! << 16) |
    (digest[offset + 2]! << 8) |
    digest[offset + 3]!;
  return (binary % 1_000_000).toString().padStart(6, "0");
}

describe("totp", () => {
  it("verifies a freshly computed code and rejects a wrong one", () => {
    const secret = generateSecret();
    const code = reference(secret);
    expect(verifyTotp(secret, code)).toBe(true);
    expect(verifyTotp(secret, "000000")).toBe(reference(secret) === "000000");
    expect(verifyTotp(secret, "12345")).toBe(false); // wrong length
    expect(verifyTotp(secret, "abcdef")).toBe(false); // non-numeric
  });

  it("generates a 32-char base32 secret and a valid otpauth URI", () => {
    const secret = generateSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    const uri = otpauthUri("GDB Runner", "alice", secret);
    expect(uri).toContain("otpauth://totp/");
    expect(uri).toContain(`secret=${secret}`);
    expect(uri).toContain("algorithm=SHA1");
    expect(uri).toContain("digits=6");
  });

  it("rejects a code from a different secret", () => {
    const a = generateSecret();
    const b = generateSecret();
    expect(verifyTotp(b, reference(a))).toBe(reference(a) === reference(b));
  });
});
