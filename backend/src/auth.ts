import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "vocab_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

const USERNAME_RE = /^[A-Za-z0-9_一-龥-]{2,20}$/;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 72;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_OPTIONS = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

export type AuthCredentials = { username: string; password: string };

export function parseAuthCredentials(value: unknown): AuthCredentials | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (typeof input.username !== "string" || typeof input.password !== "string") return null;
  const username = input.username.trim().normalize("NFKC");
  const password = input.password.normalize("NFC");
  if (!USERNAME_RE.test(username) || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) return null;
  return { username, password };
}

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, SCRYPT_KEY_LENGTH, SCRYPT_OPTIONS, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

/** Versioned scrypt record. The password itself is never persisted. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password.normalize("NFC"), salt);
  return `scrypt$v1$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, record: string): Promise<boolean> {
  const [algorithm, version, encodedSalt, encodedKey, extra] = record.split("$");
  if (algorithm !== "scrypt" || version !== "v1" || !encodedSalt || !encodedKey || extra !== undefined) return false;
  try {
    const salt = Buffer.from(encodedSalt, "base64url");
    const expected = Buffer.from(encodedKey, "base64url");
    if (salt.length !== 16 || expected.length !== SCRYPT_KEY_LENGTH) return false;
    const actual = await derive(password.normalize("NFC"), salt);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function createSessionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashSessionToken(token) };
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function sessionExpiresAt(now = new Date()): string {
  return new Date(now.getTime() + SESSION_TTL_MS).toISOString();
}

export function readSessionToken(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const pair of cookieHeader.split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 0) continue;
    const name = pair.slice(0, separator).trim();
    if (name !== SESSION_COOKIE) continue;
    const value = pair.slice(separator + 1).trim();
    return /^[A-Za-z0-9_-]{40,128}$/.test(value) ? value : null;
  }
  return null;
}

export function sessionCookie(token: string, secure: boolean): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    "Path=/api",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1_000)}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function clearSessionCookie(secure: boolean): string {
  return [
    `${SESSION_COOKIE}=`,
    "Path=/api",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}
