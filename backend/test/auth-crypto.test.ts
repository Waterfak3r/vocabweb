import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clearSessionCookie,
  createSessionToken,
  hashPassword,
  hashSessionToken,
  parseAuthCredentials,
  readSessionToken,
  sessionCookie,
  sessionExpiresAt,
  verifyPassword,
} from "../src/auth.js";

test("auth credentials normalize usernames and reject malformed input", () => {
  assert.deepEqual(parseAuthCredentials({ username: "  Ａlice  ", password: "password123" }), {
    username: "Alice",
    password: "password123",
  });
  assert.equal(parseAuthCredentials({ username: "a", password: "password123" }), null);
  assert.equal(parseAuthCredentials({ username: "alice!", password: "password123" }), null);
  assert.equal(parseAuthCredentials({ username: "alice", password: "short" }), null);
});

test("scrypt password records are salted, versioned, and verifiable", async () => {
  const first = await hashPassword("correct horse battery staple");
  const second = await hashPassword("correct horse battery staple");
  assert.match(first, /^scrypt\$v1\$/);
  assert.notEqual(first, second);
  assert.equal(first.includes("correct horse"), false);
  assert.equal(await verifyPassword("correct horse battery staple", first), true);
  assert.equal(await verifyPassword("wrong password", first), false);
  assert.equal(await verifyPassword("anything", "broken"), false);
});

test("session tokens persist only through a deterministic hash", () => {
  const session = createSessionToken();
  assert.match(session.token, /^[A-Za-z0-9_-]{40,128}$/);
  assert.equal(session.tokenHash, hashSessionToken(session.token));
  assert.equal(session.tokenHash.includes(session.token), false);
});

test("session cookies are scoped, http-only, same-site, and parse safely", () => {
  const { token } = createSessionToken();
  const cookie = sessionCookie(token, true);
  assert.match(cookie, /Path=\/api/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);
  assert.equal(readSessionToken(`theme=ink; ${cookie}`), token);
  assert.equal(readSessionToken("vocab_session=not valid"), null);
  assert.match(clearSessionCookie(false), /Max-Age=0/);
});

test("session expiry is thirty days after the supplied clock", () => {
  assert.equal(sessionExpiresAt(new Date("2026-01-01T00:00:00.000Z")), "2026-01-31T00:00:00.000Z");
});
