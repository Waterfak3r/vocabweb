import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { FixedWindowRateLimiter } from "./http/rate-limit.js";
import { SqliteEngagementStore } from "./engagement/store.js";
import { WiktApiProvider } from "./providers/wiktapi.js";
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
const pronunciationLookup = new WordService(remoteProvider, {
  cacheTtlMs: config.wordCacheTtlMs,
  cacheMaxEntries: config.wordCacheMaxEntries,
});
const americanPronunciationLookup = new WordService(new WiktApiProvider({
  baseUrl: config.wiktApiBaseUrl,
  timeoutMs: config.wiktApiTimeoutMs,
  accent: "us",
}), {
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
const studyStore = new SqliteStudyStore(config.databaseFile, { legacyJsonFile: config.dataFile });
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
  adminUsernames: (process.env.ADMIN_USERNAMES ?? "Waterfak3r").split(",").map((name) => name.trim()).filter(Boolean),
  ...(config.trustProxy ? { trustProxy: config.trustProxy } : {}),
  ...(config.staticDir ? { staticDir: config.staticDir } : {}),
});

app.listen(config.port, () => {
  console.log(`Vacabweb backend listening on http://localhost:${config.port}`);
});
