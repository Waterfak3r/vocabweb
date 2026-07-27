import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { FixedWindowRateLimiter } from "./http/rate-limit.js";
import { WiktApiProvider } from "./providers/wiktapi.js";
import { SqliteStudyStore } from "./study/sqlite-store.js";
import { WordService } from "./words/word-service.js";

const config = loadConfig();
const provider = new WiktApiProvider({
  baseUrl: config.wiktApiBaseUrl,
  timeoutMs: config.wiktApiTimeoutMs,
});
const wordLookup = new WordService(provider, {
  cacheTtlMs: config.wordCacheTtlMs,
  cacheMaxEntries: config.wordCacheMaxEntries,
});
const wordRateLimiter = new FixedWindowRateLimiter({
  windowMs: config.wordRateLimitWindowMs,
  maxRequests: config.wordRateLimitMaxRequests,
});
const loginRateLimiter = new FixedWindowRateLimiter({
  windowMs: config.loginRateLimitWindowMs,
  maxRequests: config.loginRateLimitMaxRequests,
});
const studyStore = new SqliteStudyStore(config.databaseFile, { legacyJsonFile: config.dataFile });
const app = createApp({
  frontendOrigins: config.frontendOrigins,
  wordLookup,
  wordRateLimiter,
  loginRateLimiter,
  studyStore,
  ...(config.trustProxy ? { trustProxy: config.trustProxy } : {}),
  ...(config.staticDir ? { staticDir: config.staticDir } : {}),
});

app.listen(config.port, () => {
  console.log(`Vacabweb backend listening on http://localhost:${config.port}`);
});
