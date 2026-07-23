import cors from "cors";
import express, { type ErrorRequestHandler, type RequestHandler } from "express";
import { FixedWindowRateLimiter, type RateLimiter } from "./http/rate-limit.js";
import { WiktApiProvider } from "./providers/wiktapi.js";
import { isValidWordQuery, normalizeWord } from "./words/normalize.js";
import { WordService, type WordLookup } from "./words/word-service.js";
import { WordProviderError } from "./words/types.js";

export interface CreateAppOptions {
  frontendOrigins?: string[];
  wordLookup?: WordLookup;
  wordRateLimiter?: RateLimiter;
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

export function createApp(options: CreateAppOptions = {}) {
  const app = express();
  const allowedOrigins = options.frontendOrigins ?? ["http://localhost:5173"];
  const wordLookup = options.wordLookup ?? new WordService(new WiktApiProvider());
  const wordRateLimiter =
    options.wordRateLimiter ??
    new FixedWindowRateLimiter({ windowMs: 60_000, maxRequests: 60 });

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

    if (error instanceof URIError && request.originalUrl.startsWith("/api/words/")) {
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
