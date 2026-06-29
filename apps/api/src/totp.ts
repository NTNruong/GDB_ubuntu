import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Minimal RFC 6238 TOTP (SHA-1, 6 digits, 30s period) — no external dependency.
 * The shared secret is stored base32 (the authenticator-app convention) and, at
 * rest in users.json, additionally AES-encrypted via ai/keystore. Used for the
 * optional/admin-mandatory 2FA second factor.
 */
const DIGITS = 6;
const PERIOD = 30;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Generate a fresh base32 secret (160 bits, the RFC-recommended SHA-1 size). */
export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

/** Build the otpauth:// URI an authenticator app scans/imports. */
export function otpauthUri(issuer: string, account: string, secret: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(PERIOD)
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Verify a 6-digit code against the secret, allowing ±`window` time steps for clock skew. */
export function verifyTotp(secret: string, code: string, window = 1): boolean {
  if (!/^[0-9]{6}$/.test(code)) {
    return false;
  }
  const key = base32Decode(secret);
  if (key.length === 0) {
    return false;
  }
  const counter = Math.floor(Date.now() / 1000 / PERIOD);
  for (let offset = -window; offset <= window; offset += 1) {
    const expected = hotp(key, counter + offset);
    const a = Buffer.from(expected);
    const b = Buffer.from(code);
    if (a.length === b.length && timingSafeEqual(a, b)) {
      return true;
    }
  }
  return false;
}

function hotp(key: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  // 53-bit safe write of the counter into an 8-byte big-endian buffer.
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const digest = createHmac("sha1", key).update(buf).digest();
  const last = digest[digest.length - 1];
  const tail = last === undefined ? 0 : last;
  const offset = tail & 0xf;
  const b0 = digest[offset] ?? 0;
  const b1 = digest[offset + 1] ?? 0;
  const b2 = digest[offset + 2] ?? 0;
  const b3 = digest[offset + 3] ?? 0;
  const binary = ((b0 & 0x7f) << 24) | (b1 << 16) | (b2 << 8) | b3;
  return (binary % 10 ** DIGITS).toString().padStart(DIGITS, "0");
}

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, "").replace(/\s/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) {
      return Buffer.alloc(0);
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}
