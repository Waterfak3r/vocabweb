import cors from "cors";
import express, { type ErrorRequestHandler, type RequestHandler } from "express";
import { FixedWindowRateLimiter, type RateLimiter } from "./http/rate-limit.js";
import { WiktApiProvider } from "./providers/wiktapi.js";
import { JsonFileStudyStore } from "./study/store.js";
import { parseCatalogQuery, parseClientId, parseCreateMyWordbook, parseLearningEvent, parseResourceId, parseShareCode, parseStatus, parseUploadCatalog } from "./study/validation.js";
import type { StudyStore } from "./study/types.js";
import { isValidWordQuery, normalizeWord } from "./words/normalize.js";
import { WordService, type WordLookup } from "./words/word-service.js";
import { WordProviderError } from "./words/types.js";

export interface CreateAppOptions {
  frontendOrigins?: string[];
  wordLookup?: WordLookup;
  wordRateLimiter?: RateLimiter;
  studyStore?: StudyStore;
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
  const studyStore = options.studyStore ?? new JsonFileStudyStore("./data/study-state.json");

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

  app.disable("x-powered-by");
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
          return;
        }

        callback(new CorsOriginError());
      },
    }),
  );
  app.use(express.json({ limit: "100kb" }));

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
    try { response.status(201).json(await studyStore.uploadCatalog(clientId, input)); } catch (error) { next(error); }
  });
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
