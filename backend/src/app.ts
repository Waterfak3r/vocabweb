import path from "node:path";
import cors from "cors";
import express, { type ErrorRequestHandler, type RequestHandler } from "express";
import { FixedWindowRateLimiter, type RateLimiter } from "./http/rate-limit.js";
import { WiktApiProvider } from "./providers/wiktapi.js";
import { CsvLocalChineseDictionary, type LocalChineseLookup } from "./study/local-dictionary.js";
import { JsonFileStudyStore } from "./study/store.js";
import { parseCatalogQuery, parseClientId, parseCommitImportDraft, parseCreateImportDraft, parseCreateMyWordbook, parseLearningEvent, parseResourceId, parseShareCode, parseStatus, parseUpdateCatalog, parseUpdateWord, parseUploadCatalog, parseWordId } from "./study/validation.js";
import type { ImportLineInput, PreparedImportLine, ResolvedImportDraftEntry, StudyStore, StudyWordEntry } from "./study/types.js";
import { isValidWordQuery, normalizeWord } from "./words/normalize.js";
import { WordService, type WordLookup } from "./words/word-service.js";
import { WordProviderError } from "./words/types.js";

export interface CreateAppOptions {
  frontendOrigins?: string[];
  wordLookup?: WordLookup;
  wordRateLimiter?: RateLimiter;
  mutationRateLimiter?: RateLimiter;
  studyStore?: StudyStore;
  localChineseLookup?: LocalChineseLookup;
  /** Express "trust proxy" hop count; set to the number of reverse proxies in front of the app. */
  trustProxy?: number;
  /** Absolute or cwd-relative path to a built frontend to serve (static assets + SPA fallback). */
  staticDir?: string;
}

interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}

class CorsOriginError extends Error {
  constructor() {
    super("Origin is not allowed by CORS");
    this.name = "CorsOriginError";
  }
}

function apiError(code: string, message: string): ApiErrorBody {
  return { error: { code, message } };
}

function readClientId(request: express.Request, response: express.Response): string | null {
  const clientId = parseClientId(request.header("x-vocab-client-id"));
  if (clientId) {
    return clientId;
  }

  response
    .status(400)
    .json(apiError("INVALID_CLIENT_ID", "X-Vocab-Client-Id must be a valid anonymous client id"));
  return null;
}

export function createApp(options: CreateAppOptions = {}) {
  const app = express();
  const allowedOrigins = options.frontendOrigins ?? ["http://localhost:5173", "http://127.0.0.1:5173"];
  const wordLookup = options.wordLookup ?? new WordService(new WiktApiProvider());
  const wordRateLimiter =
    options.wordRateLimiter ??
    new FixedWindowRateLimiter({ windowMs: 60_000, maxRequests: 60 });
  const mutationRateLimiter =
    options.mutationRateLimiter ??
    new FixedWindowRateLimiter({ windowMs: 60_000, maxRequests: 240 });
  const studyStore = options.studyStore ?? new JsonFileStudyStore("./data/study-state.json");
  const localChineseLookup = options.localChineseLookup ?? new CsvLocalChineseDictionary();
  const lookupJobs: Array<{ word: string; resolve: (value: Awaited<ReturnType<WordLookup["lookup"]>>) => void; reject: (reason: unknown) => void }> = [];
  let activeLookups = 0;
  const drainLookupQueue = () => {
    while (activeLookups < 6 && lookupJobs.length) {
      const job = lookupJobs.shift()!; activeLookups += 1;
      void wordLookup.lookup(job.word).then(job.resolve, job.reject).finally(() => { activeLookups -= 1; drainLookupQueue(); });
    }
  };
  const limitedLookup = (word: string) => new Promise<Awaited<ReturnType<WordLookup["lookup"]>>>((resolveLookup, rejectLookup) => {
    lookupJobs.push({ word, resolve: resolveLookup, reject: rejectLookup }); drainLookupQueue();
  });
  const backgroundDraftTasks = new Map<string, Promise<void>>();

  const enforceWordRateLimit: RequestHandler = (request, response, next) => {
    const clientKey = request.ip || request.socket.remoteAddress || "unknown";
    const decision = wordRateLimiter.consume(clientKey);

    if (!decision.allowed) {
      response.setHeader("Retry-After", Math.max(1, Math.ceil(decision.retryAfterMs / 1_000)));
      response.status(429).json(apiError("RATE_LIMITED", "Too many word lookup requests"));
      return;
    }

    next();
  };

  const enforceMutationRateLimit: RequestHandler = (request, response, next) => {
    if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") {
      next();
      return;
    }
    // Key on the IP, not the client-supplied X-Vocab-Client-Id header — rotating
    // a self-issued header must not mint fresh rate-limit windows.
    const clientKey = request.ip || request.socket.remoteAddress || "unknown";
    const decision = mutationRateLimiter.consume(clientKey);
    if (!decision.allowed) {
      response.setHeader("Retry-After", Math.max(1, Math.ceil(decision.retryAfterMs / 1_000)));
      response.status(429).json(apiError("RATE_LIMITED", "Too many requests"));
      return;
    }
    next();
  };

  const resolveOneImportLine = async (line: ImportLineInput): Promise<PreparedImportLine> => {
    const normalized = normalizeWord(line.word);
    if (!isValidWordQuery(normalized)) {
      return { ...line, status: "invalid", reason: "英文单词格式无效" };
    }
    let matched: Awaited<ReturnType<WordLookup["lookup"]>> | null = null;
    let lookupFailed = false;
    try { matched = await limitedLookup(normalized); } catch { lookupFailed = true; }
    let zhMeaning = line.zhMeaning;
    if (!zhMeaning) {
      try { zhMeaning = await localChineseLookup.lookup(normalized); } catch { /* Local dictionaries are optional. */ }
    }
    const entry: StudyWordEntry = matched
      ? { ...matched, ...(line.zhMeaning ? { zhMeaning: line.zhMeaning, zhMeaningSource: "user" as const } : zhMeaning ? { zhMeaning, zhMeaningSource: "dictionary" as const } : {}) }
      : { word: normalized, phonetic: "", meanings: [], source: "user", ...(line.zhMeaning ? { zhMeaning: line.zhMeaning, zhMeaningSource: "user" as const } : zhMeaning ? { zhMeaning, zhMeaningSource: "dictionary" as const } : {}) };
    return { line: line.line, word: normalized, ...(line.zhMeaning ? { zhMeaning: line.zhMeaning } : {}), status: matched ? "ready" : lookupFailed ? "processing" : "unmatched", ...(matched ? {} : { reason: lookupFailed ? "词典服务暂不可用，可稍后继续匹配" : "未找到词典释义" }), entry };
  };
  const processImportDraft = (clientId: string, id: string): Promise<void> => {
    const key = `${clientId}:${id}`; const existing = backgroundDraftTasks.get(key); if (existing) return existing;
    const task = (async () => {
      const draft = await studyStore.getImportDraft(clientId, id);
      if (!draft || draft.status === "committed") return;
      const processable = draft.entries.filter((entry) => entry.word && (entry.status === "processing" || (entry.status === "conflict" && !entry.entry)));
      if (!processable.length) return;
      for (let offset = 0; offset < processable.length; offset += 100) {
        const batch = processable.slice(offset, offset + 100);
        const resolved: ResolvedImportDraftEntry[] = await Promise.all(batch.map(async (entry): Promise<ResolvedImportDraftEntry> => {
          const result = await resolveOneImportLine({ line: entry.line, word: entry.word!, ...(entry.zhMeaning ? { zhMeaning: entry.zhMeaning } : {}) });
          const status: ResolvedImportDraftEntry["status"] = result.status === "ready" || result.status === "unmatched" ? result.status : "processing";
          return { id: entry.id, status, ...(result.reason ? { reason: result.reason } : {}), ...(result.entry ? { entry: result.entry } : {}) };
        }));
        await studyStore.resolveImportDraftEntries(clientId, id, resolved);
      }
    })().catch((error) => { console.error("Import draft processing failed", error); }).finally(() => { backgroundDraftTasks.delete(key); });
    backgroundDraftTasks.set(key, task); return task;
  };

  app.disable("x-powered-by");
  if (options.trustProxy) app.set("trust proxy", options.trustProxy);
  app.use(
    cors((request, callback) => {
      const expressRequest = request as express.Request;
      const origin = expressRequest.headers.origin;
      // Same-origin browser requests still send an Origin header on
      // POST/PATCH/DELETE, and in production the app is served same-origin, so
      // accept requests whose Origin matches the host that served them.
      // expressRequest.protocol honors the "trust proxy" setting (X-Forwarded-Proto).
      const sameOrigin = `${expressRequest.protocol}://${expressRequest.headers.host}`;
      if (!origin || allowedOrigins.includes(origin) || origin === sameOrigin) {
        callback(null, { origin: true });
        return;
      }

      callback(new CorsOriginError());
    }),
  );
  app.use("/api", enforceMutationRateLimit);
  app.use(express.json({ limit: "2mb" }));

  app.get("/api/health", (_request, response) => {
    response.status(200).json({ status: "ok", service: "vacabweb-backend" });
  });

  app.get(["/api/words", "/api/words/"], enforceWordRateLimit, (_request, response) => {
    response.status(400).json(apiError("INVALID_WORD", "Word query is invalid"));
  });

  app.get(
    "/api/words/:word",
    enforceWordRateLimit,
    async (request, response, next) => {
      const rawWord = request.params.word;
      if (typeof rawWord !== "string") {
        response.status(400).json(apiError("INVALID_WORD", "Word query is invalid"));
        return;
      }

      const word = normalizeWord(rawWord);
      if (!isValidWordQuery(word)) {
        response.status(400).json(apiError("INVALID_WORD", "Word query is invalid"));
        return;
      }

      try {
        const entry = await wordLookup.lookup(word);
        if (!entry) {
          response.status(404).json(apiError("WORD_NOT_FOUND", "Word was not found"));
          return;
        }

        response.setHeader("Cache-Control", "public, max-age=86400");
        response.status(200).json(entry);
      } catch (error) {
        if (error instanceof WordProviderError) {
          const status = error.code === "UPSTREAM_TIMEOUT" ? 504 : 502;
          response.status(status).json(apiError(error.code, "Dictionary provider is unavailable"));
          return;
        }

        next(error);
      }
    },
  );

  app.get("/api/catalog/wordbooks", async (request, response, next) => {
    const clientId = readClientId(request, response);
    const query = parseCatalogQuery(request.query);
    if (!clientId) return;
    if (!query) { response.status(400).json(apiError("INVALID_CATALOG_QUERY", "Catalog query is invalid")); return; }
    try { response.status(200).json(await studyStore.listCatalog(clientId, query)); } catch (error) { next(error); }
  });
  app.get("/api/catalog/favorites", async (request, response, next) => {
    const clientId = readClientId(request, response); if (!clientId) return;
    try { response.status(200).json(await studyStore.listFavorites(clientId)); } catch (error) { next(error); }
  });
  app.get("/api/catalog/uploads/mine", async (request, response, next) => {
    const clientId = readClientId(request, response); if (!clientId) return;
    try { response.status(200).json(await studyStore.listUploads(clientId)); } catch (error) { next(error); }
  });
  app.get("/api/catalog/wordbooks/:id", async (request, response, next) => {
    const clientId = readClientId(request, response); const id = parseResourceId(request.params.id);
    if (!clientId) return;
    if (!id) { response.status(400).json(apiError("INVALID_RESOURCE_ID", "Resource id is invalid")); return; }
    try { const book = await studyStore.getCatalog(clientId, id); if (!book) response.status(404).json(apiError("CATALOG_NOT_FOUND", "Catalog wordbook was not found")); else response.status(200).json(book); } catch (error) { next(error); }
  });
  app.post("/api/catalog/wordbooks/:id/favorite", async (request, response, next) => {
    const clientId = readClientId(request, response); const id = parseResourceId(request.params.id);
    if (!clientId) return;
    if (!id) { response.status(400).json(apiError("INVALID_RESOURCE_ID", "Resource id is invalid")); return; }
    try { const result = await studyStore.toggleFavorite(clientId, id); if (!result) response.status(404).json(apiError("CATALOG_NOT_FOUND", "Catalog wordbook was not found")); else response.status(200).json(result); } catch (error) { next(error); }
  });
  app.post("/api/catalog/wordbooks/:id/add", async (request, response, next) => {
    const clientId = readClientId(request, response); const id = parseResourceId(request.params.id);
    if (!clientId) return;
    if (!id) { response.status(400).json(apiError("INVALID_RESOURCE_ID", "Resource id is invalid")); return; }
    try { const result = await studyStore.addCatalogToMine(clientId, id); if (!result) response.status(404).json(apiError("CATALOG_NOT_FOUND", "Catalog wordbook was not found")); else response.status(result.created ? 201 : 200).json(result); } catch (error) { next(error); }
  });
  app.post("/api/catalog/uploads", async (request, response, next) => {
    const clientId = readClientId(request, response); const input = parseUploadCatalog(request.body);
    if (!clientId) return;
    if (!input) { response.status(400).json(apiError("INVALID_CATALOG_UPLOAD", "Catalog upload is invalid")); return; }
    try { const catalog = await studyStore.uploadCatalog(clientId, input); if (!catalog) response.status(404).json(apiError("WORDBOOK_NOT_FOUND", "Source wordbook was not found")); else response.status(201).json(catalog); } catch (error) { next(error); }
  });
  const updateCatalogSnapshot: RequestHandler = async (request, response, next) => {
    const clientId = readClientId(request, response); const id = parseResourceId(request.params.id); const input = parseUpdateCatalog(request.body);
    if (!clientId) return;
    if (!id) { response.status(400).json(apiError("INVALID_RESOURCE_ID", "Resource id is invalid")); return; }
    if (!input) { response.status(400).json(apiError("INVALID_CATALOG_UPLOAD", "Catalog update is invalid")); return; }
    try { const catalog = await studyStore.updateCatalog(clientId, id, input); if (!catalog) response.status(404).json(apiError("CATALOG_NOT_FOUND", "Catalog wordbook or source wordbook was not found")); else response.status(200).json(catalog); } catch (error) { next(error); }
  };
  app.patch("/api/catalog/wordbooks/:id", updateCatalogSnapshot);
  app.put("/api/catalog/wordbooks/:id", updateCatalogSnapshot);
  app.post("/api/catalog/imports", async (request, response, next) => {
    const clientId = readClientId(request, response); const shareCode = parseShareCode(request.body && typeof request.body === "object" ? (request.body as { shareCode?: unknown }).shareCode : undefined);
    if (!clientId) return;
    if (!shareCode) { response.status(400).json(apiError("INVALID_SHARE_CODE", "Share code is invalid")); return; }
    try { const result = await studyStore.importShareCode(clientId, shareCode); if (!result) response.status(404).json(apiError("SHARE_CODE_NOT_FOUND", "Share code was not found")); else response.status(result.created ? 201 : 200).json(result); } catch (error) { next(error); }
  });
  app.get("/api/my/wordbooks", async (request, response, next) => {
    const clientId = readClientId(request, response); const trash = request.query.view === "trash";
    if (!clientId) return; try { response.status(200).json(await studyStore.listMyWordbooks(clientId, trash)); } catch (error) { next(error); }
  });
  app.post("/api/my/wordbooks", async (request, response, next) => {
    const clientId = readClientId(request, response); const input = parseCreateMyWordbook(request.body);
    if (!clientId) return;
    if (!input) { response.status(400).json(apiError("INVALID_WORDBOOK", "Wordbook is invalid")); return; }
    try { response.status(201).json(await studyStore.createMyWordbook(clientId, input)); } catch (error) { next(error); }
  });
  app.get("/api/my/wordbooks/:id", async (request, response, next) => {
    const clientId = readClientId(request, response); const id = parseResourceId(request.params.id);
    if (!clientId) return;
    if (!id) { response.status(400).json(apiError("INVALID_RESOURCE_ID", "Resource id is invalid")); return; }
    try { const book = await studyStore.getMyWordbook(clientId, id); if (!book) response.status(404).json(apiError("WORDBOOK_NOT_FOUND", "Wordbook was not found")); else response.status(200).json(book); } catch (error) { next(error); }
  });
  app.delete("/api/my/wordbooks/:id", async (request, response, next) => {
    const clientId = readClientId(request, response); const id = parseResourceId(request.params.id);
    if (!clientId) return;
    if (!id) { response.status(400).json(apiError("INVALID_RESOURCE_ID", "Resource id is invalid")); return; }
    try { if (!await studyStore.deleteMyWordbook(clientId, id)) response.status(404).json(apiError("WORDBOOK_NOT_FOUND", "Wordbook was not found")); else response.status(204).end(); } catch (error) { next(error); }
  });
  app.post("/api/my/wordbooks/:id/restore", async (request, response, next) => {
    const clientId = readClientId(request, response); const id = parseResourceId(request.params.id);
    if (!clientId) return;
    if (!id) { response.status(400).json(apiError("INVALID_RESOURCE_ID", "Resource id is invalid")); return; }
    try { const book = await studyStore.restoreMyWordbook(clientId, id); if (!book) response.status(404).json(apiError("WORDBOOK_NOT_FOUND", "Wordbook was not found")); else response.status(200).json(book); } catch (error) { next(error); }
  });
  app.get("/api/my/wordbooks/:id/words", async (request, response, next) => {
    const clientId = readClientId(request, response); const id = parseResourceId(request.params.id); const status = parseStatus(request.query.status);
    if (!clientId) return;
    if (!id || status === null) { response.status(400).json(apiError("INVALID_QUEUE_QUERY", "Queue query is invalid")); return; }
    try { const words = await studyStore.listWords(clientId, id, status); if (!words) response.status(404).json(apiError("WORDBOOK_NOT_FOUND", "Wordbook was not found")); else response.status(200).json(words); } catch (error) { next(error); }
  });
  app.patch("/api/my/wordbooks/:id/words/:wordId", async (request, response, next) => {
    const clientId = readClientId(request, response); const wordbookId = parseResourceId(request.params.id); const wordId = parseWordId(request.params.wordId); const input = parseUpdateWord(request.body);
    if (!clientId) return;
    if (!wordbookId || !wordId || !input) { response.status(400).json(apiError("INVALID_WORD_UPDATE", "Word update is invalid")); return; }
    try {
      const prepared = input.word ? await resolveOneImportLine({ line: 1, word: input.word, ...(typeof input.zhMeaning === "string" ? { zhMeaning: input.zhMeaning } : {}) }) : undefined;
      // "processing" means the dictionary lookup failed transiently — never let the
      // empty fallback entry wipe the word's existing dictionary fields.
      const lookupFailed = prepared?.status === "processing";
      const rematched = prepared && !lookupFailed ? prepared.entry : undefined;
      const result = await studyStore.updateWord(clientId, wordbookId, wordId, input, rematched, { lookupFailed });
      if (result.kind === "not-found") response.status(404).json(apiError("WORD_NOT_FOUND", "Wordbook or word was not found"));
      else if (result.kind === "duplicate") response.status(409).json(apiError("DUPLICATE_WORD", "The word already exists in this wordbook"));
      else if (result.kind === "lookup-failed") response.status(503).json(apiError("DICTIONARY_UNAVAILABLE", "Dictionary lookup is temporarily unavailable; retry the rename later"));
      else response.status(200).json(result.word);
    } catch (error) { next(error); }
  });
  app.get("/api/my/import-drafts", async (request, response, next) => {
    const clientId = readClientId(request, response); if (!clientId) return;
    try { response.status(200).json(await studyStore.listImportDrafts(clientId)); } catch (error) { next(error); }
  });
  app.post("/api/my/import-drafts", async (request, response, next) => {
    const clientId = readClientId(request, response); const input = parseCreateImportDraft(request.body);
    if (!clientId) return;
    if (!input) { response.status(400).json(apiError("INVALID_IMPORT_DRAFT", "Import draft is invalid or exceeds the file limit")); return; }
    try {
      const drafts = await studyStore.createImportDrafts(clientId, input);
      if (!drafts[0]) response.status(404).json(apiError("WORDBOOK_NOT_FOUND", "Target wordbook was not found"));
      else {
        for (const draft of drafts) void processImportDraft(clientId, draft.id);
        response.status(201).json(drafts[0]);
      }
    } catch (error) { next(error); }
  });
  app.get("/api/my/import-drafts/:id", async (request, response, next) => {
    const clientId = readClientId(request, response); const id = parseResourceId(request.params.id); if (!clientId) return;
    if (!id) { response.status(400).json(apiError("INVALID_RESOURCE_ID", "Resource id is invalid")); return; }
    try { const draft = await studyStore.getImportDraft(clientId, id); if (!draft) response.status(404).json(apiError("IMPORT_DRAFT_NOT_FOUND", "Import draft was not found")); else response.status(200).json(draft); } catch (error) { next(error); }
  });
  app.delete("/api/my/import-drafts/:id", async (request, response, next) => {
    const clientId = readClientId(request, response); const id = parseResourceId(request.params.id); if (!clientId) return;
    if (!id) { response.status(400).json(apiError("INVALID_RESOURCE_ID", "Resource id is invalid")); return; }
    try { if (!await studyStore.deleteImportDraft(clientId, id)) response.status(404).json(apiError("IMPORT_DRAFT_NOT_FOUND", "Import draft was not found")); else response.status(204).end(); } catch (error) { next(error); }
  });
  app.post("/api/my/import-drafts/:id/commit", async (request, response, next) => {
    const clientId = readClientId(request, response); const id = parseResourceId(request.params.id); const input = parseCommitImportDraft(request.body);
    if (!clientId) return;
    if (!id || !input) { response.status(400).json(apiError("INVALID_IMPORT_COMMIT", "Import draft commit is invalid")); return; }
    try {
      const draft = await studyStore.getImportDraft(clientId, id);
      if (!draft) { response.status(404).json(apiError("IMPORT_DRAFT_NOT_FOUND", "Import draft or target wordbook was not found")); return; }
      if (draft.status === "processing") { response.status(409).json(apiError("IMPORT_DRAFT_PROCESSING", "Import draft is still matching dictionary data")); return; }
      const wordbook = await studyStore.commitImportDraft(clientId, id, input);
      if (!wordbook) response.status(404).json(apiError("IMPORT_DRAFT_NOT_FOUND", "Import draft or target wordbook was not found")); else response.status(200).json(wordbook);
    } catch (error) { next(error); }
  });
  app.post("/api/my/import-drafts/:id/process", async (request, response, next) => {
    const clientId = readClientId(request, response); const id = parseResourceId(request.params.id); if (!clientId) return;
    if (!id) { response.status(400).json(apiError("INVALID_RESOURCE_ID", "Resource id is invalid")); return; }
    try {
      const draft = await studyStore.getImportDraft(clientId, id);
      if (!draft) { response.status(404).json(apiError("IMPORT_DRAFT_NOT_FOUND", "Import draft was not found")); return; }
      if (draft.status === "committed") { response.status(409).json(apiError("IMPORT_DRAFT_COMMITTED", "Committed drafts cannot be processed")); return; }
      void processImportDraft(clientId, id);
      response.status(202).json(draft);
    } catch (error) { next(error); }
  });
  app.post("/api/study/events", async (request, response, next) => {
    const clientId = readClientId(request, response); const input = parseLearningEvent(request.body);
    if (!clientId) return;
    if (!input) { response.status(400).json(apiError("INVALID_STUDY_EVENT", "Study event is invalid")); return; }
    try { const event = await studyStore.recordEvent(clientId, input); if (!event) response.status(404).json(apiError("STUDY_WORD_NOT_FOUND", "Word or wordbook was not found")); else response.status(201).json(event); } catch (error) { next(error); }
  });
  app.get("/api/study/dashboard/:wordbookId", async (request, response, next) => {
    const clientId = readClientId(request, response); const id = parseResourceId(request.params.wordbookId);
    if (!clientId) return;
    if (!id) { response.status(400).json(apiError("INVALID_RESOURCE_ID", "Resource id is invalid")); return; }
    try { const dashboard = await studyStore.getDashboard(clientId, id); if (!dashboard) response.status(404).json(apiError("WORDBOOK_NOT_FOUND", "Wordbook was not found")); else response.status(200).json(dashboard); } catch (error) { next(error); }
  });

  // Serve the built frontend (static assets + SPA fallback) when a static dir is
  // configured. API routes live under /api and are registered above, so static
  // files (index:false disables directory index resolution) cannot shadow them.
  if (options.staticDir) {
    const staticDir = options.staticDir;
    // express res.sendFile requires an absolute path; resolve against cwd if relative.
    const staticRoot = path.resolve(staticDir);
    const indexHtmlPath = path.resolve(staticRoot, "index.html");

    app.use(
      express.static(staticDir, {
        index: false,
        setHeaders(response, filePath) {
          // Vite emits hashed filenames under an "assets" directory; those are safe
          // to cache forever. Everything else must be revalidated each request.
          // Match "assets" only within the served tree, not in the root's own path.
          const relative = path.relative(staticRoot, filePath);
          if (relative.split(/[\\/]/).includes("assets")) {
            response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          } else {
            response.setHeader("Cache-Control", "no-cache");
          }
        },
      }),
    );

    // SPA deep-link fallback. Registered as a plain middleware (Express 5 /
    // path-to-regexp v8 rejects bare "*" string wildcards). GET/HEAD requests for
    // non-/api paths that matched no static file get index.html so client-side
    // routing can take over; every other request falls through to the JSON 404.
    app.use((request, response, next) => {
      if ((request.method === "GET" || request.method === "HEAD") && !request.path.startsWith("/api")) {
        response.setHeader("Cache-Control", "no-cache");
        response.sendFile(indexHtmlPath, (error) => {
          if (error) next(error);
        });
        return;
      }
      next();
    });
  }

  app.use((_request, response) => {
    response.status(404).json(apiError("NOT_FOUND", "Route not found"));
  });

  const errorHandler: ErrorRequestHandler = (error, request, response, _next) => {
    if (error instanceof CorsOriginError) {
      response
        .status(403)
        .json(apiError("CORS_ORIGIN_DENIED", "Origin is not allowed"));
      return;
    }

    if (
      error instanceof URIError &&
      (request.originalUrl.startsWith("/api/words/") ||
        request.originalUrl.startsWith("/api/wordbook/"))
    ) {
      response.status(400).json(apiError("INVALID_WORD", "Word query is invalid"));
      return;
    }

    if (error instanceof SyntaxError && "body" in error) {
      response.status(400).json(apiError("INVALID_JSON", "Request body contains invalid JSON"));
      return;
    }

    console.error(error);
    response.status(500).json(apiError("INTERNAL_ERROR", "An unexpected error occurred"));
  };

  app.use(errorHandler);

  return app;
}
