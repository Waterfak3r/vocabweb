import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { FixedWindowRateLimiter } from "./http/rate-limit.js";
import { WiktApiProvider } from "./providers/wiktapi.js";
import { JsonFileStudyStore } from "./study/store.js";
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
const studyStore = new JsonFileStudyStore(config.dataFile);
const app = createApp({
  frontendOrigins: config.frontendOrigins,
  wordLookup,
  wordRateLimiter,
  studyStore,
  ...(config.trustProxy ? { trustProxy: config.trustProxy } : {}),
});

app.listen(config.port, () => {
  console.log(`Vacabweb backend listening on http://localhost:${config.port}`);
});
