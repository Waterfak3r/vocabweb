import "dotenv/config";

export interface AppConfig {
  port: number;
  frontendOrigins: string[];
  wiktApiBaseUrl: string;
  wiktApiTimeoutMs: number;
  wordCacheTtlMs: number;
  wordCacheMaxEntries: number;
  wordRateLimitWindowMs: number;
  wordRateLimitMaxRequests: number;
  wordSuggestionRateLimitWindowMs: number;
  wordSuggestionRateLimitMaxRequests: number;
  loginRateLimitWindowMs: number;
  loginRateLimitMaxRequests: number;
  registrationEnabled: boolean;
  maxWordbooksPerClient: number;
  maxWordsPerClient: number;
  maxDraftsPerClient: number;
  trustProxy: number;
  databaseFile: string;
  /** Legacy JSON source retained for one-time SQLite migration. */
  dataFile: string;
  staticDir: string;
  dictionaryFile: string;
  dictionaryRemoteFallback: boolean;
}

function parseInteger(
  name: string,
  value: string | undefined,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value ?? defaultValue);

  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }

  return parsed;
}

function parseWiktApiBaseUrl(value: string | undefined): string {
  const rawUrl = value ?? "https://api.wiktapi.dev/v1/en/word";

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("WIKTAPI_BASE_URL must be a valid HTTP(S) URL");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("WIKTAPI_BASE_URL must be a valid HTTP(S) URL");
  }

  return rawUrl.replace(/\/+$/, "");
}

function parseBoolean(name: string, value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || !value.trim()) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "on", "yes"].includes(normalized)) return true;
  if (["0", "false", "off", "no"].includes(normalized)) return false;
  throw new Error(`${name} must be true or false`);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: parseInteger("PORT", env.PORT, 3_000, 1, 65_535),
    frontendOrigins: (env.FRONTEND_ORIGIN ?? "http://localhost:5173,http://127.0.0.1:5173")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    wiktApiBaseUrl: parseWiktApiBaseUrl(env.WIKTAPI_BASE_URL),
    wiktApiTimeoutMs: parseInteger(
      "WIKTAPI_TIMEOUT_MS",
      env.WIKTAPI_TIMEOUT_MS,
      5_000,
      1,
      5_000,
    ),
    wordCacheTtlMs: parseInteger(
      "WORD_CACHE_TTL_MS",
      env.WORD_CACHE_TTL_MS,
      60 * 60 * 1_000,
      1,
      7 * 24 * 60 * 60 * 1_000,
    ),
    wordCacheMaxEntries: parseInteger(
      "WORD_CACHE_MAX_ENTRIES",
      env.WORD_CACHE_MAX_ENTRIES,
      1_000,
      1,
      100_000,
    ),
    wordRateLimitWindowMs: parseInteger(
      "WORD_RATE_LIMIT_WINDOW_MS",
      env.WORD_RATE_LIMIT_WINDOW_MS,
      60_000,
      1_000,
      60 * 60 * 1_000,
    ),
    wordRateLimitMaxRequests: parseInteger(
      "WORD_RATE_LIMIT_MAX_REQUESTS",
      env.WORD_RATE_LIMIT_MAX_REQUESTS,
      60,
      1,
      100_000,
    ),
    wordSuggestionRateLimitWindowMs: parseInteger(
      "WORD_SUGGESTION_RATE_LIMIT_WINDOW_MS",
      env.WORD_SUGGESTION_RATE_LIMIT_WINDOW_MS,
      60_000,
      1_000,
      60 * 60 * 1_000,
    ),
    wordSuggestionRateLimitMaxRequests: parseInteger(
      "WORD_SUGGESTION_RATE_LIMIT_MAX_REQUESTS",
      env.WORD_SUGGESTION_RATE_LIMIT_MAX_REQUESTS,
      240,
      1,
      100_000,
    ),
    loginRateLimitWindowMs: parseInteger(
      "LOGIN_RATE_LIMIT_WINDOW_MS", env.LOGIN_RATE_LIMIT_WINDOW_MS, 15 * 60_000, 1_000, 24 * 60 * 60 * 1_000,
    ),
    loginRateLimitMaxRequests: parseInteger(
      "LOGIN_RATE_LIMIT_MAX_REQUESTS", env.LOGIN_RATE_LIMIT_MAX_REQUESTS, 10, 1, 100_000,
    ),
    registrationEnabled: parseBoolean("REGISTRATION_ENABLED", env.REGISTRATION_ENABLED, true),
    maxWordbooksPerClient: parseInteger("MAX_WORDBOOKS_PER_CLIENT", env.MAX_WORDBOOKS_PER_CLIENT, 50, 1, 10_000),
    maxWordsPerClient: parseInteger("MAX_WORDS_PER_CLIENT", env.MAX_WORDS_PER_CLIENT, 50_000, 1, 1_000_000),
    maxDraftsPerClient: parseInteger("MAX_DRAFTS_PER_CLIENT", env.MAX_DRAFTS_PER_CLIENT, 20, 1, 1_000),
    trustProxy: parseInteger("TRUST_PROXY", env.TRUST_PROXY, 0, 0, 10),
    databaseFile: (() => {
      const value = env.DATABASE_FILE?.trim() || "./data/study-state.sqlite";
      if (value.length > 1_000) {
        throw new Error("DATABASE_FILE must be at most 1000 characters");
      }
      return value;
    })(),
    dataFile: (() => {
      const value = env.DATA_FILE?.trim() || "./data/study-state.json";
      if (value.length > 1_000) {
        throw new Error("DATA_FILE must be at most 1000 characters");
      }
      return value;
    })(),
    staticDir: (() => {
      const value = env.STATIC_DIR?.trim() ?? "";
      if (value.length > 1_000) {
        throw new Error("STATIC_DIR must be at most 1000 characters");
      }
      return value;
    })(),
    dictionaryFile: env.DICTIONARY_FILE?.trim() || "../resources/dictionaries/generated/vocab.sqlite",
    dictionaryRemoteFallback: !["0", "false", "off"].includes((env.DICTIONARY_REMOTE_FALLBACK ?? "true").toLowerCase()),
  };
}
