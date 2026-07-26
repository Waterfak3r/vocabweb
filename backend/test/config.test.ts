import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../src/config.js";

test("loadConfig provides bounded word lookup defaults", () => {
  assert.deepEqual(loadConfig({}), {
    port: 3_000,
    frontendOrigins: ["http://localhost:5173", "http://127.0.0.1:5173"],
    wiktApiBaseUrl: "https://api.wiktapi.dev/v1/en/word",
    wiktApiTimeoutMs: 5_000,
    wordCacheTtlMs: 3_600_000,
    wordCacheMaxEntries: 1_000,
    wordRateLimitWindowMs: 60_000,
    wordRateLimitMaxRequests: 60,
    dataFile: "./data/study-state.json",
  });
});

test("loadConfig parses configured word lookup settings", () => {
  const config = loadConfig({
    PORT: "3100",
    FRONTEND_ORIGIN: "https://one.example, https://two.example",
    WIKTAPI_BASE_URL: "http://wiktapi.internal/word/",
    WIKTAPI_TIMEOUT_MS: "2500",
    WORD_CACHE_TTL_MS: "10000",
    WORD_CACHE_MAX_ENTRIES: "25",
    WORD_RATE_LIMIT_WINDOW_MS: "30000",
    WORD_RATE_LIMIT_MAX_REQUESTS: "10",
    DATA_FILE: "C:/data/vocab.json",
  });

  assert.deepEqual(config, {
    port: 3_100,
    frontendOrigins: ["https://one.example", "https://two.example"],
    wiktApiBaseUrl: "http://wiktapi.internal/word",
    wiktApiTimeoutMs: 2_500,
    wordCacheTtlMs: 10_000,
    wordCacheMaxEntries: 25,
    wordRateLimitWindowMs: 30_000,
    wordRateLimitMaxRequests: 10,
    dataFile: "C:/data/vocab.json",
  });
});

test("loadConfig rejects invalid provider and timeout settings", () => {
  assert.throws(
    () => loadConfig({ WIKTAPI_TIMEOUT_MS: "5001" }),
    /WIKTAPI_TIMEOUT_MS/,
  );
  assert.throws(
    () => loadConfig({ WIKTAPI_BASE_URL: "file:///dictionary" }),
    /WIKTAPI_BASE_URL/,
  );
});
