import { access } from "node:fs/promises";
import path from "node:path";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { FixedWindowRateLimiter } from "./http/rate-limit.js";
import { SqliteEngagementStore } from "./engagement/store.js";
import { WiktApiProvider } from "./providers/wiktapi.js";
import { YoudaoPronunciationProvider } from "./providers/youdao.js";
import { SqliteLocalDictionaryProvider } from "./providers/local-dictionary.js";
import { FallbackDictionaryProvider } from "./providers/fallback-dictionary.js";
import { SqliteStudyStore } from "./study/sqlite-store.js";
import { WordService } from "./words/word-service.js";

const config = loadConfig();
const remoteProvider = new WiktApiProvider({
  baseUrl: config.wiktApiBaseUrl,
  timeoutMs: config.wiktApiTimeoutMs,
});
const localProvider = new SqliteLocalDictionaryProvider(config.dictionaryFile);
const provider = new FallbackDictionaryProvider(localProvider, remoteProvider, config.dictionaryRemoteFallback);
const wordLookup = new WordService(provider, {
  cacheTtlMs: config.wordCacheTtlMs,
  cacheMaxEntries: config.wordCacheMaxEntries,
});
const pronunciationLookup = new WordService(new YoudaoPronunciationProvider({ accent: "gb" }), {
  cacheTtlMs: config.wordCacheTtlMs,
  cacheMaxEntries: config.wordCacheMaxEntries,
});
const americanPronunciationLookup = new WordService(new YoudaoPronunciationProvider({ accent: "us" }), {
  cacheTtlMs: config.wordCacheTtlMs,
  cacheMaxEntries: config.wordCacheMaxEntries,
});
const wordRateLimiter = new FixedWindowRateLimiter({
  windowMs: config.wordRateLimitWindowMs,
  maxRequests: config.wordRateLimitMaxRequests,
});
const wordSuggestionRateLimiter = new FixedWindowRateLimiter({
  windowMs: config.wordSuggestionRateLimitWindowMs,
  maxRequests: config.wordSuggestionRateLimitMaxRequests,
});
const loginRateLimiter = new FixedWindowRateLimiter({
  windowMs: config.loginRateLimitWindowMs,
  maxRequests: config.loginRateLimitMaxRequests,
});
const studyStore = new SqliteStudyStore(config.databaseFile, {
  legacyJsonFile: config.dataFile,
  limits: {
    maxWordbooksPerClient: config.maxWordbooksPerClient,
    maxWordsPerClient: config.maxWordsPerClient,
    maxDraftsPerClient: config.maxDraftsPerClient,
  },
});
const engagementStore = new SqliteEngagementStore(config.databaseFile);
const app = createApp({
  frontendOrigins: config.frontendOrigins,
  wordLookup,
  pronunciationLookups: { gb: pronunciationLookup, us: americanPronunciationLookup },
  wordRateLimiter,
  wordSuggestionLookup: localProvider,
  wordSuggestionRateLimiter,
  loginRateLimiter,
  studyStore,
  engagementStore,
  localChineseLookup: { lookup: (word) => localProvider.lookupChinese(word) },
  registrationEnabled: config.registrationEnabled,
  productionSecurity: process.env.NODE_ENV === "production",
  readinessCheck: async () => {
    await studyStore.checkHealth();
    localProvider.checkHealth();
    if (config.staticDir) await access(path.resolve(config.staticDir, "index.html"));
  },
  ...(config.trustProxy ? { trustProxy: config.trustProxy } : {}),
  ...(config.staticDir ? { staticDir: config.staticDir } : {}),
});

const server = app.listen(config.port, () => {
  console.log(`Vacabweb backend listening on http://localhost:${config.port}`);
});

let closing = false;
const shutdown = (signal: NodeJS.Signals) => {
  if (closing) return;
  closing = true;
  console.log(`Received ${signal}; draining HTTP connections`);
  const forceTimer = setTimeout(() => {
    console.error("Graceful shutdown timed out; closing remaining connections");
    server.closeAllConnections();
  }, 10_000);
  forceTimer.unref();
  server.closeIdleConnections();
  server.close((error) => {
    clearTimeout(forceTimer);
    studyStore.close();
    engagementStore.close();
    localProvider.close();
    if (error) {
      console.error("HTTP shutdown failed", error);
    }
    process.exit(error ? 1 : 0);
  });
};
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
