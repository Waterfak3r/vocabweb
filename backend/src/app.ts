import cors from "cors";
import express, { type ErrorRequestHandler, type RequestHandler } from "express";
import { FixedWindowRateLimiter, type RateLimiter } from "./http/rate-limit.js";
import { WiktApiProvider } from "./providers/wiktapi.js";
import { JsonFileStudyStore, normalizeWordbookId } from "./study/store.js";
import { parseClientId, parseStudyEvent, parseStudyWordEntry } from "./study/validation.js";
import type { StudyStore } from "./study/types.js";
import { isValidWordQuery, normalizeWord } from "./words/normalize.js";
import { WordService, type WordLookup } from "./words/word-service.js";
import { WordProviderError } from "./words/types.js";

export interface CreateAppOptions {
  frontendOrigins?: string[];
  wordLookup?: WordLookup;
  wordRateLimiter?: RateLimiter;
  studyStore?: StudyStore;
  studyDailyGoal?: number;
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
  const allowedOrigins = options.frontendOrigins ?? ["http://localhost:5173"];
  const wordLookup = options.wordLookup ?? new WordService(new WiktApiProvider());
  const wordRateLimiter =
    options.wordRateLimiter ??
    new FixedWindowRateLimiter({ windowMs: 60_000, maxRequests: 60 });
  const studyStore = options.studyStore ?? new JsonFileStudyStore("./data/study-state.json");
  const studyDailyGoal = options.studyDailyGoal ?? 80;

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

  app.get("/api/study/summary", async (request, response, next) => {
    const clientId = readClientId(request, response);
    if (!clientId) {
      return;
    }

    try {
      response.status(200).json(await studyStore.getSummary(clientId, studyDailyGoal));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/study/events", async (request, response, next) => {
    const clientId = readClientId(request, response);
    if (!clientId) {
      return;
    }

    const event = parseStudyEvent(request.body);
    if (!event) {
      response.status(400).json(apiError("INVALID_STUDY_EVENT", "Study event is invalid"));
      return;
    }

    try {
      response.status(201).json(await studyStore.recordEvent(clientId, event));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/wordbook", async (request, response, next) => {
    const clientId = readClientId(request, response);
    if (!clientId) {
      return;
    }

    try {
      response.status(200).json(await studyStore.listWordbook(clientId));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/wordbook", async (request, response, next) => {
    const clientId = readClientId(request, response);
    if (!clientId) {
      return;
    }

    const entry = parseStudyWordEntry(request.body);
    if (!entry) {
      response.status(400).json(apiError("INVALID_WORDBOOK_ENTRY", "Wordbook entry is invalid"));
      return;
    }

    try {
      const result = await studyStore.addWord(clientId, entry);
      response.status(result.created ? 201 : 200).json(result.item);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/wordbook/:word", async (request, response, next) => {
    const clientId = readClientId(request, response);
    if (!clientId) {
      return;
    }

    const rawWord = request.params.word;
    if (typeof rawWord !== "string") {
      response.status(400).json(apiError("INVALID_WORD", "Word query is invalid"));
      return;
    }
    const word = normalizeWordbookId(rawWord);
    if (!isValidWordQuery(word)) {
      response.status(400).json(apiError("INVALID_WORD", "Word query is invalid"));
      return;
    }

    try {
      const removed = await studyStore.removeWord(clientId, word);
      if (!removed) {
        response.status(404).json(apiError("WORDBOOK_ENTRY_NOT_FOUND", "Wordbook entry was not found"));
        return;
      }
      response.status(204).end();
    } catch (error) {
      next(error);
    }
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
