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
    wordSuggestionRateLimitWindowMs: 60_000,
    wordSuggestionRateLimitMaxRequests: 240,
    loginRateLimitWindowMs: 900_000,
    loginRateLimitMaxRequests: 10,
    registrationEnabled: true,
    maxWordbooksPerClient: 50,
    maxWordsPerClient: 50_000,
    maxDraftsPerClient: 20,
    trustProxy: 0,
    staticDir: "",
    databaseFile: "./data/study-state.sqlite",
    dataFile: "./data/study-state.json",
    dictionaryFile: "../resources/dictionaries/generated/vocab.sqlite",
    dictionaryRemoteFallback: true,
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
    WORD_SUGGESTION_RATE_LIMIT_WINDOW_MS: "20000",
    WORD_SUGGESTION_RATE_LIMIT_MAX_REQUESTS: "120",
    LOGIN_RATE_LIMIT_WINDOW_MS: "120000",
    LOGIN_RATE_LIMIT_MAX_REQUESTS: "4",
    REGISTRATION_ENABLED: "off",
    MAX_WORDBOOKS_PER_CLIENT: "12",
    MAX_WORDS_PER_CLIENT: "3456",
    MAX_DRAFTS_PER_CLIENT: "7",
    TRUST_PROXY: "1",
    STATIC_DIR: " ../frontend/dist ",
    DATABASE_FILE: "C:/data/vocab.sqlite",
    DATA_FILE: "C:/data/vocab.json",
    DICTIONARY_FILE: "C:/data/dictionary.sqlite",
    DICTIONARY_REMOTE_FALLBACK: "false",
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
    wordSuggestionRateLimitWindowMs: 20_000,
    wordSuggestionRateLimitMaxRequests: 120,
    loginRateLimitWindowMs: 120_000,
    loginRateLimitMaxRequests: 4,
    registrationEnabled: false,
    maxWordbooksPerClient: 12,
    maxWordsPerClient: 3_456,
    maxDraftsPerClient: 7,
    trustProxy: 1,
    staticDir: "../frontend/dist",
    databaseFile: "C:/data/vocab.sqlite",
    dataFile: "C:/data/vocab.json",
    dictionaryFile: "C:/data/dictionary.sqlite",
    dictionaryRemoteFallback: false,
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
  assert.throws(
    () => loadConfig({ REGISTRATION_ENABLED: "sometimes" }),
    /REGISTRATION_ENABLED/,
  );
});
