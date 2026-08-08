import path from "node:path";
import cors from "cors";
import express, { type ErrorRequestHandler, type RequestHandler } from "express";
import helmet from "helmet";
import { MemoryEngagementStore, type EngagementStore, type FeedbackInput, type FeedbackType, type MessageActor } from "./engagement/store.js";
import {
  clearSessionCookie, createSessionToken, hashPassword, hashSessionToken, parseAuthCredentials, parsePasswordChange,
  readSessionToken, sessionCookie, sessionExpiresAt, verifyPassword,
} from "./auth.js";
import { FixedWindowRateLimiter, type RateLimiter } from "./http/rate-limit.js";
import { isChineseSuggestionQuery, type WordSuggestionLookup } from "./providers/local-dictionary.js";
import { WiktApiProvider } from "./providers/wiktapi.js";
import { YoudaoPronunciationProvider } from "./providers/youdao.js";
import { CsvLocalChineseDictionary, type LocalChineseLookup } from "./study/local-dictionary.js";
import { JsonFileStudyStore, StudyResourceLimitError } from "./study/store.js";
import {
  parseAddWord, parseBatchWords, parseCatalogQuery, parseCatalogWordsQuery, parseClientId, parseCommitImportDraft, parseCreateCatalogContribution, parseCreateImportDraft,
  parseCursorQuery,
  parseCreateMyWordbook, parseLearningEvent, parseResourceId, parseShareCode, parseStartStudyRound, parseStatus,
  parseResolveCatalogContribution, parseRevertRevision, parseStudyRoundAnswer, parseStudyRoundRevision, parseUpdateCatalog, parseUpdateMyWordbook, parseUpdateStudySettings,
  isCatalogTitle, parseMyWordbookWordsQuery, parseUpdateWord, parseUploadCatalog, parseWordId,
} from "./study/validation.js";
import type {
  AccountUser,
  AccountStudyProfile,
  ContributionMutationResult,
  ImportDraft,
  ImportLineInput,
  PreparedImportLine,
  ResolvedImportDraftEntry,
  RevisionMutationResult,
  StudyStore,
  StudyWordEntry,
} from "./study/types.js";
import { isValidWordQuery, normalizeWord } from "./words/normalize.js";
import { WordService, type WordLookup } from "./words/word-service.js";
import { WordProviderError } from "./words/types.js";
import { capabilitiesFor, hasCapability } from "./authorization.js";

export interface CreateAppOptions {
  frontendOrigins?: string[];
  wordLookup?: WordLookup;
  /** Online pronunciation lookup, separate from the offline-first definition path. */
  pronunciationLookup?: WordLookup;
  pronunciationLookups?: Partial<Record<"gb" | "us", WordLookup>>;
  wordRateLimiter?: RateLimiter;
  wordSuggestionLookup?: WordSuggestionLookup;
  wordSuggestionRateLimiter?: RateLimiter;
  mutationRateLimiter?: RateLimiter;
  loginRateLimiter?: RateLimiter;
  studyStore?: StudyStore;
  engagementStore?: EngagementStore;
  localChineseLookup?: LocalChineseLookup;
  registrationEnabled?: boolean;
  /** Production-only browser protections: secure cookies, HSTS, and strict cookie mutation origins. */
  productionSecurity?: boolean;
  /** Express "trust proxy" hop count; set to the number of reverse proxies in front of the app. */
  trustProxy?: number;
  /** Absolute or cwd-relative path to a built frontend to serve (static assets + SPA fallback). */
  staticDir?: string;
  readinessCheck?: () => Promise<void>;
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

class AuthCapacityError extends Error {
  constructor() {
    super("Authentication crypto capacity is busy");
    this.name = "AuthCapacityError";
  }
}

class LookupCapacityError extends Error {
  constructor() {
    super("Dictionary lookup queue is full");
    this.name = "LookupCapacityError";
  }
}

function apiError(code: string, message: string): ApiErrorBody {
  return { error: { code, message } };
}

function sendContributionMutation(response: express.Response, result: ContributionMutationResult): void {
  if (result.kind === "created") {
    response.status(201).json(result.contribution);
  } else if (result.kind === "updated") {
    response.status(200).json(result.contribution);
  } else if (result.kind === "not-found") {
    response.status(404).json(apiError("CONTRIBUTION_NOT_FOUND", "Contribution or wordbook was not found"));
  } else if (result.kind === "forbidden") {
    response.status(403).json(apiError("CONTRIBUTION_FORBIDDEN", "You cannot manage this contribution"));
  } else if (result.kind === "disabled") {
    response.status(409).json(apiError("COLLABORATION_DISABLED", "Collaboration is not available for this wordbook"));
  } else if (result.kind === "stale") {
    response.status(409).json({
      ...apiError("CONTRIBUTION_STALE", "The source or public version changed; preview the contribution again"),
      headRevisionId: result.headRevisionId,
      ...(result.sourceUpdatedAt ? { sourceUpdatedAt: result.sourceUpdatedAt } : {}),
    });
  } else if (result.kind === "duplicate-open") {
    response.status(409).json({
      ...apiError("CONTRIBUTION_ALREADY_OPEN", "You already have an open contribution for this wordbook"),
      contributionId: result.contributionId,
    });
  } else if (result.kind === "empty") {
    response.status(409).json(apiError("CONTRIBUTION_EMPTY", "There are no public word changes to submit"));
  } else if (result.kind === "too-large") {
    response.status(422).json({
      ...apiError("CONTRIBUTION_TOO_LARGE", "A contribution can change at most 500 words"),
      changeCount: result.count,
    });
  } else {
    response.status(409).json({
      ...apiError("CONTRIBUTION_CONFLICT", "The public or publisher source wordbook has overlapping changes"),
      conflicts: result.conflicts,
    });
  }
}

function sendRevisionMutation(response: express.Response, result: RevisionMutationResult): void {
  if (result.kind === "updated") {
    response.status(201).json(result.revision);
  } else if (result.kind === "not-found") {
    response.status(404).json(apiError("REVISION_NOT_FOUND", "Revision or wordbook was not found"));
  } else if (result.kind === "forbidden") {
    response.status(403).json(apiError("REVISION_FORBIDDEN", "Only the publisher can revert this revision"));
  } else if (result.kind === "disabled") {
    response.status(409).json(apiError("COLLABORATION_DISABLED", "Collaboration is not available for this wordbook"));
  } else if (result.kind === "stale") {
    response.status(409).json({
      ...apiError("REVISION_HEAD_STALE", "The public wordbook changed; preview the revert again"),
      headRevisionId: result.headRevisionId,
    });
  } else if (result.kind === "already-reverted") {
    response.status(409).json(apiError("REVISION_ALREADY_REVERTED", "Every change in this revision is already reverted"));
  } else {
    response.status(409).json({
      ...apiError("REVISION_REVERT_CONFLICT", "Later revisions changed one or more of the same words"),
      conflicts: result.conflicts,
    });
  }
}

const POS_ALIASES: Record<string, string> = {
  n: "noun", noun: "noun",
  v: "verb", vi: "verb", vt: "verb", verb: "verb",
  a: "adjective", s: "adjective", adj: "adjective", adjective: "adjective",
  r: "adverb", adv: "adverb", adverb: "adverb",
  prep: "preposition", preposition: "preposition",
  pron: "pronoun", pronoun: "pronoun",
  conj: "conjunction", conjunction: "conjunction",
  interj: "interjection", int: "interjection", interjection: "interjection",
  aux: "auxiliary", auxiliary: "auxiliary",
  det: "determiner", determiner: "determiner",
  num: "numeral", numeral: "numeral",
  phr: "phrase", phrase: "phrase",
};

function comparablePos(value: string): string {
  const compact = value.trim().toLowerCase().replace(/\./g, "").replace(/\s+/g, " ");
  return POS_ALIASES[compact] ?? compact;
}

function dictionaryHeadword(value: string): string {
  return value.replace(/ \((?:[a-z0-9]{2,12}|[a-z0-9]{1,8}(?:[&/-][a-z0-9]{1,8}){1,3})\)$/i, "");
}

function phrasePronunciationTokens(value: string): string[] {
  return value
    .replace(/\.\.\./g, " ")
    .split(/\s+/)
    .filter((token) => token && !/^(?:sb|sth|smb|smth)\.$/.test(token))
    .filter(isValidWordQuery);
}

function phoneticBody(value: string): string {
  const phonetic = value.trim();
  if (
    (phonetic.startsWith("/") && phonetic.endsWith("/"))
    || (phonetic.startsWith("[") && phonetic.endsWith("]"))
  ) {
    return phonetic.slice(1, -1).trim();
  }
  return phonetic;
}

const DONATION_IMAGE_SETTING = "donation_image_url";

function parseDonationImageUrl(value: unknown): string | null | undefined {
  if (value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const candidate = value.trim();
  if (!candidate || candidate.length > 1_900_000) return undefined;
  if (/^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(candidate)) return candidate;
  if (candidate.startsWith("/") && !candidate.startsWith("//") && candidate.length <= 2_048) return candidate;
  return undefined;
}


type RequestIdentity = {
  user: AccountUser | null;
  clientId: string | null;
  headerClientId: string | null;
  headerClaimedBy: AccountUser | null;
  sessionTokenHash: string | null;
};

function identityOf(response: express.Response): RequestIdentity {
  return response.locals.identity as RequestIdentity;
}

function readClientId(_request: express.Request, response: express.Response): string | null {
  const identity = identityOf(response);
  if (!identity.user && identity.headerClaimedBy) {
    response.status(401).json(apiError("AUTH_REQUIRED", "This data belongs to a registered account"));
    return null;
  }
  const clientId = identity.clientId;
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
  const pronunciationLookupGb = options.pronunciationLookups?.gb
    ?? options.pronunciationLookup
    ?? options.wordLookup
    ?? new WordService(new YoudaoPronunciationProvider({ accent: "gb" }));
  const pronunciationLookupUs = options.pronunciationLookups?.us
    ?? options.pronunciationLookup
    ?? options.wordLookup
    ?? new WordService(new YoudaoPronunciationProvider({ accent: "us" }));
  const wordSuggestionLookup = options.wordSuggestionLookup ?? {
    async suggest() { return []; },
  };
  const wordRateLimiter =
    options.wordRateLimiter ??
    new FixedWindowRateLimiter({ windowMs: 60_000, maxRequests: 60 });
  const wordSuggestionRateLimiter =
    options.wordSuggestionRateLimiter ??
    new FixedWindowRateLimiter({ windowMs: 60_000, maxRequests: 240 });
  const mutationRateLimiter =
    options.mutationRateLimiter ??
    new FixedWindowRateLimiter({ windowMs: 60_000, maxRequests: 240 });
  const loginRateLimiter =
    options.loginRateLimiter ??
    new FixedWindowRateLimiter({ windowMs: 15 * 60_000, maxRequests: 10 });
  const studyStore = options.studyStore ?? new JsonFileStudyStore("./data/study-state.json");
  const engagementStore = options.engagementStore ?? new MemoryEngagementStore();
  const localChineseLookup = options.localChineseLookup ?? new CsvLocalChineseDictionary();
  const guestMessageRateLimiter = new FixedWindowRateLimiter({ windowMs: 10 * 60_000, maxRequests: 3 });
  const userMessageRateLimiter = new FixedWindowRateLimiter({ windowMs: 10 * 60_000, maxRequests: 10 });
  // Missing usernames still pay the same scrypt verification cost as real users.
  const dummyPasswordHash = hashPassword(createSessionToken().token);
  let activeAuthCrypto = 0;
  const runAuthCrypto = async <T>(operation: () => Promise<T>): Promise<T> => {
    // scrypt runs on libuv's bounded worker pool. Reject excess work promptly so
    // distributed attempts cannot starve unrelated filesystem/DNS operations.
    if (activeAuthCrypto >= 4) throw new AuthCapacityError();
    activeAuthCrypto += 1;
    try { return await operation(); } finally { activeAuthCrypto -= 1; }
  };
  const lookupJobs: Array<{ word: string; resolve: (value: Awaited<ReturnType<WordLookup["lookup"]>>) => void; reject: (reason: unknown) => void }> = [];
  let activeLookups = 0;
  const drainLookupQueue = () => {
    while (activeLookups < 6 && lookupJobs.length) {
      const job = lookupJobs.shift()!; activeLookups += 1;
      void Promise.resolve()
        .then(() => wordLookup.lookup(job.word))
        .then(
          (value) => {
            activeLookups -= 1;
            drainLookupQueue();
            job.resolve(value);
          },
          (error) => {
            activeLookups -= 1;
            drainLookupQueue();
            job.reject(error);
          },
        );
    }
  };
  const limitedLookup = (word: string) => new Promise<Awaited<ReturnType<WordLookup["lookup"]>>>((resolveLookup, rejectLookup) => {
    if (lookupJobs.length + activeLookups >= 100) {
      rejectLookup(new LookupCapacityError());
      return;
    }
    lookupJobs.push({ word, resolve: resolveLookup, reject: rejectLookup }); drainLookupQueue();
  });
  const backgroundDraftTasks = new Map<string, Promise<void>>();
  // Every created or resumed batch is appended to this FIFO chain, so imports wait
  // their turn instead of being rejected when the site is busy. A 500-entry draft
  // can fill the bounded lookup queue by itself; FIFO ordering delays later drafts
  // instead of failing them.
  let backgroundDraftQueue = Promise.resolve();
  let backgroundDraftQueueDepth = 0;
  const backgroundDraftStarted = new Set<string>();

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

  const enforceWordSuggestionRateLimit: RequestHandler = (request, response, next) => {
    const clientKey = request.ip || request.socket.remoteAddress || "unknown";
    const decision = wordSuggestionRateLimiter.consume(clientKey);

    if (!decision.allowed) {
      response.setHeader("Retry-After", Math.max(1, Math.ceil(decision.retryAfterMs / 1_000)));
      response.status(429).json(apiError("RATE_LIMITED", "Too many word suggestion requests"));
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
    const lookupWord = dictionaryHeadword(normalized);
    let matched: Awaited<ReturnType<WordLookup["lookup"]>> | null = null;
    let lookupFailed = false;
    try { matched = await limitedLookup(lookupWord); } catch { lookupFailed = true; }
    let composedPhonetic = "";
    const isPhrase = lookupWord.includes(" ") || lookupWord.includes("...");
    if (isPhrase && !matched?.phonetic.trim() && !lookupFailed) {
      const tokens = phrasePronunciationTokens(lookupWord);
      const parts: string[] = [];
      for (const token of tokens) {
        try {
          const component = await limitedLookup(token);
          const phonetic = component?.phonetic ? phoneticBody(component.phonetic) : "";
          if (!phonetic) {
            parts.length = 0;
            break;
          }
          parts.push(phonetic);
        } catch {
          lookupFailed = true;
          parts.length = 0;
          break;
        }
      }
      if (parts.length && parts.length === tokens.length) composedPhonetic = `/${parts.join(" ")}/`;
    }
    let zhMeaning = line.zhMeaning;
    if (!zhMeaning) {
      try { zhMeaning = await localChineseLookup.lookup(lookupWord); } catch { /* Local dictionaries are optional. */ }
    }
    let meanings = line.meanings !== undefined ? structuredClone(line.meanings) : matched?.meanings ?? [];
    const matchedMeaningIndex = line.pos
      ? meanings.findIndex((meaning) => comparablePos(meaning.pos) === comparablePos(line.pos!))
      : -1;
    const preferredMeaningIndex = matchedMeaningIndex >= 0 ? matchedMeaningIndex : 0;
    if (line.meanings === undefined && line.enDefinition) {
      const fallback = meanings[preferredMeaningIndex];
      meanings = [{
        pos: line.pos || fallback?.pos || "unknown",
        definition: line.enDefinition,
        ...((line.example || fallback?.example) ? { example: line.example || fallback?.example } : {}),
      }];
    } else if (line.meanings === undefined && (line.pos || line.example)) {
      if (!meanings.length || (line.pos && matchedMeaningIndex < 0)) {
        meanings = [...meanings, {
          pos: line.pos || "unknown",
          definition: "",
          ...(line.example ? { example: line.example } : {}),
        }];
      } else {
        meanings = meanings.map((meaning, index) => index === preferredMeaningIndex ? {
          ...meaning,
          ...(line.pos ? { pos: line.pos } : {}),
          ...(line.example ? { example: line.example } : {}),
        } : meaning);
      }
    }
    const entry: StudyWordEntry = {
      ...(matched ?? { word: normalized, phonetic: "", source: "user" as const }),
      ...(line.phonetic ? { phonetic: line.phonetic } : composedPhonetic ? { phonetic: composedPhonetic } : {}),
      word: normalized,
      meanings,
      ...(line.meanings !== undefined || line.phonetic || line.enDefinition || line.pos || line.example ? { source: "user" as const } : {}),
      ...(line.zhMeaning ? { zhMeaning: line.zhMeaning, zhMeaningSource: "user" as const } : zhMeaning ? { zhMeaning, zhMeaningSource: "dictionary" as const } : {}),
    };
    return {
      ...line, word: normalized,
      status: matched ? "ready" : lookupFailed ? "processing" : "unmatched",
      ...(matched ? {} : {
        reason: lookupFailed
          ? "词典服务暂不可用，可稍后继续匹配"
          : composedPhonetic
            ? "未找到整词组释义，已按组成单词补全音标"
            : "未找到词典释义",
      }),
      entry,
    };
  };
  const processImportDraft = (clientId: string, id: string, finalizeLookupFailures = false): Promise<void> => {
    const key = `${clientId}:${id}`; const existing = backgroundDraftTasks.get(key);
    // The dialog and the header badge both nudge /process while a batch is
    // queued or running. Reuse the in-flight task instead of chaining another
    // full re-run behind it, otherwise polling grows the FIFO queue unboundedly.
    if (existing) return existing;
    backgroundDraftQueueDepth += 1;
    const queued = backgroundDraftQueue.then(async () => {
      backgroundDraftStarted.add(key);
      const draft = await studyStore.getImportDraft(clientId, id);
      if (!draft || draft.status === "committed") return;
      const processable = draft.entries.filter((entry) => entry.word && (entry.status === "processing" || ((entry.status === "conflict" || entry.status === "duplicate") && !entry.entry)));
      if (!processable.length) return;
      const resolved: ResolvedImportDraftEntry[] = [];
      for (let offset = 0; offset < processable.length; offset += 100) {
        const batch = processable.slice(offset, offset + 100);
        resolved.push(...await Promise.all(batch.map(async (entry): Promise<ResolvedImportDraftEntry> => {
          const result = await resolveOneImportLine({
            line: entry.line, word: entry.word!,
            ...(entry.phonetic ? { phonetic: entry.phonetic } : {}), ...(entry.pos ? { pos: entry.pos } : {}), ...(entry.enDefinition ? { enDefinition: entry.enDefinition } : {}),
            ...(entry.zhMeaning ? { zhMeaning: entry.zhMeaning } : {}), ...(entry.example ? { example: entry.example } : {}),
            ...(entry.meanings !== undefined ? { meanings: entry.meanings } : {}),
          });
          const status: ResolvedImportDraftEntry["status"] = result.status === "processing" && finalizeLookupFailures
            ? "unmatched"
            : result.status === "ready" || result.status === "unmatched" || result.status === "invalid"
              ? result.status
              : "processing";
          const reason = result.status === "processing" && finalizeLookupFailures
            ? "词典服务暂不可用，已保留原始词条供确认"
            : result.reason;
          return { id: entry.id, status, ...(reason ? { reason } : {}), ...(result.entry ? { entry: result.entry } : {}) };
        })));
      }
      // Persist the whole batch in one transition: each write deep-clones the
      // client state and rewrites the SQLite JSON row, so writing once per
      // 500-entry batch instead of per 100 lookups keeps imports responsive.
      await studyStore.resolveImportDraftEntries(clientId, id, resolved);
    });
    const task = queued
      .catch((error) => { console.error("Import draft processing failed", error); })
      .finally(() => {
        backgroundDraftTasks.delete(key);
        backgroundDraftStarted.delete(key);
        backgroundDraftQueueDepth -= 1;
      });
    backgroundDraftTasks.set(key, task);
    backgroundDraftQueue = task;
    return task;
  };
  /** True while a batch is waiting in the FIFO queue and has not started yet. */
  const draftQueueState = (clientId: string, id: string) => {
    const key = `${clientId}:${id}`;
    return backgroundDraftTasks.has(key) && !backgroundDraftStarted.has(key);
  };
  const withDraftQueueState = (clientId: string, draft: ImportDraft): ImportDraft =>
    draft.status === "processing" && draftQueueState(clientId, draft.id) ? { ...draft, queued: true } : draft;

  app.disable("x-powered-by");
  if (options.trustProxy) app.set("trust proxy", options.trustProxy);
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", "data:"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", "data:", "https:"],
        mediaSrc: ["'self'", "https:"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        upgradeInsecureRequests: null,
      },
    },
    frameguard: { action: "deny" },
    strictTransportSecurity: options.productionSecurity
      ? { maxAge: 31_536_000, includeSubDomains: true }
      : false,
  }));
  app.use("/api", (_request, response, next) => {
    // API responses are non-cacheable unless a specific public route overrides
    // this header after completing its identity-independent lookup.
    response.setHeader("Cache-Control", "private, no-store");
    next();
  });
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
        callback(null, { origin: true, credentials: true });
        return;
      }

      callback(new CorsOriginError());
    }),
  );
  app.use("/api", enforceMutationRateLimit);
  app.use(express.json({ limit: "2mb" }));
  app.use("/api", async (request, response, next) => {
    try {
      const headerClientId = parseClientId(request.header("x-vocab-client-id"));
      const token = readSessionToken(request.header("cookie"));
      const tokenHash = token ? hashSessionToken(token) : null;
      const session = tokenHash ? await studyStore.getSession(tokenHash, new Date()) : null;
      const headerClaimedBy = !session && headerClientId ? await studyStore.getUserByClientId(headerClientId) : null;
      response.locals.identity = {
        user: session?.user ?? null,
        clientId: session?.user.clientId ?? headerClientId,
        headerClientId,
        headerClaimedBy,
        sessionTokenHash: tokenHash,
      } satisfies RequestIdentity;
      next();
    } catch (error) {
      next(error);
    }
  });
  app.use("/api", (request, response, next) => {
    if (!options.productionSecurity || ["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      next();
      return;
    }
    const identity = identityOf(response);
    if (!identity.sessionTokenHash) {
      next();
      return;
    }
    const origin = request.header("origin");
    const fetchSite = request.header("sec-fetch-site");
    if (!origin || fetchSite === "cross-site") {
      response.status(403).json(apiError("CSRF_ORIGIN_DENIED", "Authenticated mutations require a same-origin browser request"));
      return;
    }
    next();
  });

  const authDto = (user: AccountUser) => ({
    username: user.username,
    clientId: user.clientId,
    role: user.role,
    createdAt: user.createdAt,
    capabilities: capabilitiesFor(user),
  });
  const beginSession = async (response: express.Response, user: AccountUser) => {
    const created = createSessionToken();
    await studyStore.createSession(created.tokenHash, user.id, sessionExpiresAt());
    response.setHeader("Set-Cookie", sessionCookie(created.token, options.productionSecurity || response.req.secure));
  };
  const enforceLoginRateLimit: RequestHandler = (request, response, next) => {
    const clientKey = request.ip || request.socket.remoteAddress || "unknown";
    const decision = loginRateLimiter.consume(clientKey);
    if (!decision.allowed) {
      response.setHeader("Retry-After", Math.max(1, Math.ceil(decision.retryAfterMs / 1_000)));
      response.status(429).json(apiError("LOGIN_RATE_LIMITED", "Too many login attempts"));
      return;
    }
    next();
  };

  app.post("/api/auth/register", enforceLoginRateLimit, async (request, response, next) => {
    if (options.registrationEnabled === false) {
      response.status(403).json(apiError("REGISTRATION_DISABLED", "Public account registration is disabled"));
      return;
    }
    const credentials = parseAuthCredentials(request.body);
    const identity = identityOf(response);
    if (!credentials) {
      response.status(400).json(apiError("INVALID_CREDENTIALS", "Username or password is invalid"));
      return;
    }
    if (!identity.headerClientId) {
      response.status(400).json(apiError("INVALID_CLIENT_ID", "X-Vocab-Client-Id must be a valid anonymous client id"));
      return;
    }
    if (identity.user || identity.headerClaimedBy) {
      response.status(409).json(apiError("CLIENT_ID_ALREADY_REGISTERED", "This client id already belongs to an account"));
      return;
    }
    try {
      const passwordHash = await runAuthCrypto(() => hashPassword(credentials.password));
      const result = await studyStore.createUser(credentials.username, passwordHash, identity.headerClientId);
      if (result.kind === "taken") {
        response.status(409).json(apiError("USERNAME_TAKEN", "Username is already in use"));
        return;
      }
      if (result.kind === "client-taken") {
        response.status(409).json(apiError("CLIENT_ID_ALREADY_REGISTERED", "This client id already belongs to an account"));
        return;
      }
      await beginSession(response, result.user);
      response.status(201).json(authDto(result.user));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/auth/login", enforceLoginRateLimit, async (request, response, next) => {
    const credentials = parseAuthCredentials(request.body);
    const identity = identityOf(response);
    if (!credentials || !identity.headerClientId) {
      response.status(400).json(apiError("INVALID_CREDENTIALS", "Username, password, or client id is invalid"));
      return;
    }
    try {
      const user = await studyStore.getUserByUsername(credentials.username);
      const passwordRecord = user?.passwordHash ?? await dummyPasswordHash;
      const passwordMatches = await runAuthCrypto(() => verifyPassword(credentials.password, passwordRecord));
      if (!user || !passwordMatches) {
        response.status(401).json(apiError("INVALID_LOGIN", "Username or password is incorrect"));
        return;
      }
      if (identity.user && identity.user.id !== user.id) {
        response.status(409).json(apiError("ACTIVE_SESSION_ACCOUNT_CONFLICT", "Log out before signing in to another account"));
        return;
      }
      if (identity.headerClaimedBy && identity.headerClaimedBy.id !== user.id) {
        response.status(409).json(apiError("CLIENT_ID_ACCOUNT_CONFLICT", "This client id belongs to another account"));
        return;
      }
      if (!identity.user && !identity.headerClaimedBy && identity.headerClientId !== user.clientId) {
        await studyStore.mergeClients(identity.headerClientId, user.clientId);
      }
      await beginSession(response, user);
      response.status(200).json(authDto(user));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/auth/logout", async (_request, response, next) => {
    try {
      const identity = identityOf(response);
      if (identity.sessionTokenHash) await studyStore.deleteSession(identity.sessionTokenHash);
      response.setHeader("Set-Cookie", clearSessionCookie(options.productionSecurity || response.req.secure));
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/auth/me", (_request, response) => {
    const user = identityOf(response).user;
    if (!user) {
      response.status(401).json(apiError("AUTH_REQUIRED", "No active account session"));
      return;
    }
    response.status(200).json(authDto(user));
  });

  app.get("/api/account/export", async (_request, response, next) => {
    const user = identityOf(response).user;
    if (!user) {
      response.status(401).json(apiError("AUTH_REQUIRED", "No active account session"));
      return;
    }
    try {
      const study = await studyStore.exportUserData(user.id);
      const engagement = await engagementStore.exportUserData(user.id);
      response.setHeader("Content-Disposition", `attachment; filename="vacabweb-${new Date().toISOString().slice(0, 10)}.json"`);
      response.status(200).json({ exportedAt: new Date().toISOString(), study, engagement });
    } catch (error) { next(error); }
  });

  app.get("/api/account/profile", async (_request, response, next) => {
    const user = identityOf(response).user;
    if (!user) {
      response.status(401).json(apiError("AUTH_REQUIRED", "No active account session"));
      return;
    }
    try {
      const profile: AccountStudyProfile = await studyStore.getAccountStudyProfile(user.clientId);
      response.status(200).json(profile);
    } catch (error) { next(error); }
  });

  app.post("/api/account/password", enforceLoginRateLimit, async (request, response, next) => {
    const identity = identityOf(response);
    const user = identity.user;
    const input = parsePasswordChange(request.body);
    if (!user || !identity.sessionTokenHash) {
      response.status(401).json(apiError("AUTH_REQUIRED", "No active account session"));
      return;
    }
    if (!input) {
      response.status(400).json(apiError("INVALID_PASSWORD_CHANGE", "Current and new passwords must meet the account requirements"));
      return;
    }
    if (input.currentPassword === input.newPassword) {
      response.status(409).json(apiError("PASSWORD_UNCHANGED", "The new password must be different"));
      return;
    }
    try {
      const passwordMatches = await runAuthCrypto(() => verifyPassword(input.currentPassword, user.passwordHash));
      if (!passwordMatches) {
        response.status(403).json(apiError("INVALID_PASSWORD", "Password is incorrect"));
        return;
      }
      const passwordHash = await runAuthCrypto(() => hashPassword(input.newPassword));
      if (!await studyStore.updateUserPassword(user.id, passwordHash, identity.sessionTokenHash)) {
        response.status(404).json(apiError("ACCOUNT_NOT_FOUND", "Account no longer exists"));
        return;
      }
      response.status(204).end();
    } catch (error) { next(error); }
  });

  app.delete("/api/account", async (request, response, next) => {
    const identity = identityOf(response);
    const user = identity.user;
    const credentials = user ? parseAuthCredentials({ username: user.username, password: request.body?.password }) : null;
    if (!user || !credentials) {
      response.status(user ? 400 : 401).json(apiError(user ? "INVALID_CREDENTIALS" : "AUTH_REQUIRED", "Password confirmation is required"));
      return;
    }
    try {
      const passwordMatches = await runAuthCrypto(() => verifyPassword(credentials.password, user.passwordHash));
      if (!passwordMatches) {
        response.status(403).json(apiError("INVALID_PASSWORD", "Password is incorrect"));
        return;
      }
      await engagementStore.deleteUserData(user.id);
      if (!await studyStore.deleteUser(user.id)) {
        response.status(404).json(apiError("ACCOUNT_NOT_FOUND", "Account no longer exists"));
        return;
      }
      response.setHeader("Set-Cookie", clearSessionCookie(options.productionSecurity || response.req.secure));
      response.status(204).end();
    } catch (error) { next(error); }
  });

  app.get("/api/health/live", (_request, response) => {
    response.status(200).json({ status: "ok", service: "vacabweb-backend" });
  });
  const readinessHandler: RequestHandler = async (_request, response) => {
    try {
      await options.readinessCheck?.();
      response.status(200).json({ status: "ok", service: "vacabweb-backend" });
    } catch {
      response.status(503).json(apiError("NOT_READY", "Service dependencies are not ready"));
    }
  };
  app.get("/api/health", readinessHandler);
  app.get("/api/health/ready", readinessHandler);

  app.get("/api/site-settings", async (_request, response, next) => {
    try {
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json({
        donationImageUrl: await engagementStore.getSiteSetting(DONATION_IMAGE_SETTING),
      });
    } catch (error) { next(error); }
  });

  app.get("/api/admin/site-settings", async (_request, response, next) => {
    const user = identityOf(response).user;
    if (!hasCapability(user, "site.settings.write")) {
      response.status(403).json(apiError("ADMIN_REQUIRED", "Administrator access is required"));
      return;
    }
    try {
      response.status(200).json({
        donationImageUrl: await engagementStore.getSiteSetting(DONATION_IMAGE_SETTING),
      });
    } catch (error) { next(error); }
  });

  app.patch("/api/admin/site-settings", async (request, response, next) => {
    const user = identityOf(response).user;
    if (!hasCapability(user, "site.settings.write")) {
      response.status(403).json(apiError("ADMIN_REQUIRED", "Administrator access is required"));
      return;
    }
    const donationImageUrl = parseDonationImageUrl(request.body?.donationImageUrl);
    if (donationImageUrl === undefined) {
      response.status(400).json(apiError("INVALID_DONATION_IMAGE", "Donation image must be HTTPS, a local path, or an image data URL"));
      return;
    }
    try {
      await engagementStore.setSiteSetting(DONATION_IMAGE_SETTING, donationImageUrl);
      response.status(200).json({ donationImageUrl });
    } catch (error) { next(error); }
  });

  app.post("/api/searches", async (request, response, next) => {
    const word = typeof request.body?.word === "string" ? normalizeWord(request.body.word) : "";
    if (!isValidWordQuery(word)) {
      response.status(400).json(apiError("INVALID_WORD", "Word query is invalid"));
      return;
    }
    try {
      await engagementStore.recordSearch(word);
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/searches/popular", async (request, response, next) => {
    const days = request.query.days === undefined ? 7 : Number(request.query.days);
    const limit = request.query.limit === undefined ? 8 : Number(request.query.limit);
    if (!Number.isInteger(days) || days < 1 || days > 30 || !Number.isInteger(limit) || limit < 1 || limit > 20) {
      response.status(400).json(apiError("INVALID_POPULAR_QUERY", "Popular search query is invalid"));
      return;
    }
    try {
      const since = new Date(Date.now() - days * 86_400_000);
      response.status(200).json(await engagementStore.listPopularSearches(since, limit));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/feedback", async (request, response, next) => {
    const allowedTypes: FeedbackType[] = ["suggestion", "bug", "other"];
    const type = typeof request.body?.type === "string" ? request.body.type : "";
    const message = typeof request.body?.message === "string" ? request.body.message.trim() : "";
    const contact = typeof request.body?.contact === "string" ? request.body.contact.trim() : "";
    const page = typeof request.body?.page === "string" ? request.body.page.trim() : "";
    if (!allowedTypes.includes(type as FeedbackType)
      || message.length < 1 || message.length > 1000
      || contact.length > 200 || page.length > 300) {
      response.status(400).json(apiError("INVALID_FEEDBACK", "Feedback is invalid"));
      return;
    }
    const input: FeedbackInput = {
      type: type as FeedbackType,
      message,
      ...(contact ? { contact } : {}),
      ...(page ? { page } : {}),
    };
    try {
      response.status(201).json(await engagementStore.createFeedback(input));
    } catch (error) {
      next(error);
    }
  });

  const messageActor = (response: express.Response): MessageActor | null => {
    const clientId = readClientId(response.req, response);
    if (!clientId) return null;
    const user = identityOf(response).user;
    return {
      clientId,
      ...(user ? { userId: user.id, username: user.username, isAdmin: hasCapability(user, "messages.moderate") } : {}),
    };
  };
  const messageId = (value: unknown) => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value) ? value : null;
  const messageContent = (value: unknown) => {
    const content = typeof value === "string" ? value.trim() : "";
    return content.length >= 1 && content.length <= 1_000 ? content : null;
  };
  const requireMessageAdmin = (response: express.Response): boolean => {
    const user = identityOf(response).user;
    if (hasCapability(user, "messages.moderate")) return true;
    response.status(403).json(apiError("ADMIN_REQUIRED", "Message board administrator access is required"));
    return false;
  };
  const enforceMessagePostingLimit: RequestHandler = (request, response, next) => {
    const user = identityOf(response).user;
    const limiter = user ? userMessageRateLimiter : guestMessageRateLimiter;
    const clientKey = `${user ? "user" : "guest"}:${request.ip || request.socket.remoteAddress || "unknown"}`;
    const decision = limiter.consume(clientKey);
    if (!decision.allowed) {
      response.setHeader("Retry-After", Math.max(1, Math.ceil(decision.retryAfterMs / 1_000)));
      response.status(429).json(apiError("MESSAGE_RATE_LIMITED", "Too many messages; try again later"));
      return;
    }
    next();
  };

  app.get("/api/messages", async (request, response, next) => {
    const identity = identityOf(response);
    const actor = identity.clientId ? {
      clientId: identity.clientId,
      ...(identity.user ? { userId: identity.user.id, username: identity.user.username, isAdmin: hasCapability(identity.user, "messages.moderate") } : {}),
    } : null;
    const cursor = typeof request.query.cursor === "string" && request.query.cursor.length <= 500 ? request.query.cursor : undefined;
    const limit = request.query.limit === undefined ? 20 : Number(request.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 20 || (request.query.cursor !== undefined && !cursor)) {
      response.status(400).json(apiError("INVALID_MESSAGE_QUERY", "Message query is invalid"));
      return;
    }
    try { response.status(200).json(await engagementStore.listMessages(actor, cursor, limit)); } catch (error) { next(error); }
  });

  app.post("/api/messages", enforceMessagePostingLimit, async (request, response, next) => {
    const actor = messageActor(response); if (!actor) return;
    const content = messageContent(request.body?.content);
    const parentId = request.body?.parentId === undefined ? undefined : messageId(request.body.parentId);
    const contact = typeof request.body?.contact === "string" ? request.body.contact.trim() : "";
    const nickname = actor.userId ? undefined : typeof request.body?.nickname === "string" ? request.body.nickname.trim() : "";
    if (!content || parentId === null || contact.length > 200 || (!actor.userId && (nickname.length < 2 || nickname.length > 30))) {
      response.status(400).json(apiError("INVALID_MESSAGE", "Message is invalid"));
      return;
    }
    try {
      const created = await engagementStore.createMessage(actor, { content, ...(nickname ? { nickname } : {}), ...(contact ? { contact } : {}), ...(parentId ? { parentId } : {}) });
      if (!created) response.status(404).json(apiError("PARENT_MESSAGE_NOT_FOUND", "Parent message was not found"));
      else response.status(201).json(created);
    } catch (error) { next(error); }
  });

  app.patch("/api/messages/:id", async (request, response, next) => {
    const actor = messageActor(response); const id = messageId(request.params.id); const content = messageContent(request.body?.content);
    if (!actor) return;
    if (!id || !content) { response.status(400).json(apiError("INVALID_MESSAGE", "Message is invalid")); return; }
    try {
      const result = await engagementStore.editMessage(actor, id, content);
      if (!result) response.status(404).json(apiError("MESSAGE_NOT_FOUND", "Message was not found"));
      else if (result === "forbidden") response.status(403).json(apiError("MESSAGE_EDIT_FORBIDDEN", "Message can no longer be edited"));
      else response.status(200).json(result);
    } catch (error) { next(error); }
  });

  app.delete("/api/messages/:id", async (request, response, next) => {
    const actor = messageActor(response); const id = messageId(request.params.id);
    if (!actor) return;
    if (!id) { response.status(400).json(apiError("INVALID_MESSAGE_ID", "Message id is invalid")); return; }
    try {
      const result = await engagementStore.softDeleteMessage(actor, id);
      if (result === "not-found") response.status(404).json(apiError("MESSAGE_NOT_FOUND", "Message was not found"));
      else if (result === "forbidden") response.status(403).json(apiError("MESSAGE_DELETE_FORBIDDEN", "Message does not belong to this author"));
      else response.status(204).end();
    } catch (error) { next(error); }
  });

  app.patch("/api/messages/:id/moderation", async (request, response, next) => {
    const id = messageId(request.params.id); const action = request.body?.action;
    if (!requireMessageAdmin(response)) return;
    if (!id || (action !== "hide" && action !== "restore")) { response.status(400).json(apiError("INVALID_MODERATION", "Moderation action is invalid")); return; }
    try {
      if (!await engagementStore.moderateMessage(id, action)) response.status(404).json(apiError("MESSAGE_NOT_FOUND", "Message was not found"));
      else response.status(204).end();
    } catch (error) { next(error); }
  });

  app.delete("/api/messages/:id/permanent", async (request, response, next) => {
    const id = messageId(request.params.id);
    if (!requireMessageAdmin(response)) return;
    if (!id) { response.status(400).json(apiError("INVALID_MESSAGE_ID", "Message id is invalid")); return; }
    try {
      if (!await engagementStore.permanentlyDeleteMessage(id)) response.status(404).json(apiError("MESSAGE_NOT_FOUND", "Message was not found"));
      else response.status(204).end();
    } catch (error) { next(error); }
  });

  app.get("/api/messages/unread-count", async (_request, response, next) => {
    const user = identityOf(response).user;
    if (!user) { response.status(200).json({ count: 0 }); return; }
    try { response.status(200).json({ count: await engagementStore.unreadMessageCount(user.id) }); } catch (error) { next(error); }
  });

  app.post("/api/messages/read", async (_request, response, next) => {
    const user = identityOf(response).user;
    if (!user) { response.status(401).json(apiError("AUTH_REQUIRED", "Sign in to manage message notifications")); return; }
    try { await engagementStore.markMessagesRead(user.id); response.status(204).end(); } catch (error) { next(error); }
  });

  app.get(
    "/api/words/suggestions",
    (request, _response, next) => {
      // Preserve exact lookup for the legitimate headword "suggestions".
      if (request.query.q === undefined) {
        next("route");
        return;
      }
      next();
    },
    enforceWordSuggestionRateLimit,
    async (request, response, next) => {
      const rawQuery = typeof request.query.q === "string"
        ? request.query.q.trim().replace(/\s+/g, " ")
        : "";
      const chinese = isChineseSuggestionQuery(rawQuery);
      const query = chinese ? rawQuery : normalizeWord(rawQuery);
      const limit = request.query.limit === undefined ? 8 : Number(request.query.limit);
      if (
        query.length < 2
        || (!chinese && !isValidWordQuery(query))
        || !Number.isInteger(limit)
        || limit < 1
        || limit > 8
      ) {
        response.status(400).json(apiError("INVALID_SUGGESTION_QUERY", "Word suggestion query is invalid"));
        return;
      }

      try {
        const suggestions = await wordSuggestionLookup.suggest(query, limit);
        response.setHeader("Cache-Control", "public, max-age=300");
        response.status(200).json({ suggestions });
      } catch (error) {
        next(error);
      }
    },
  );

  app.get(["/api/words", "/api/words/"], enforceWordRateLimit, (_request, response) => {
    response.status(400).json(apiError("INVALID_WORD", "Word query is invalid"));
  });

  app.get(
    "/api/pronunciations/:word/audio",
    enforceWordSuggestionRateLimit,
    async (request, response, next) => {
      const rawWord = request.params.word;
      const word = typeof rawWord === "string" ? normalizeWord(rawWord) : "";
      if (!isValidWordQuery(word)) {
        response.status(400).json(apiError("INVALID_WORD", "Word query is invalid"));
        return;
      }
      const rawAccent = request.query.accent;
      if (rawAccent !== undefined && rawAccent !== "gb" && rawAccent !== "us") {
        response.status(400).json(apiError("INVALID_ACCENT", "Accent must be gb or us"));
        return;
      }
      const accent = rawAccent === "us" ? "us" : "gb";
      const pronunciationLookup = accent === "us" ? pronunciationLookupUs : pronunciationLookupGb;
      try {
        const entry = await pronunciationLookup.lookup(dictionaryHeadword(word));
        if (!entry?.audioUrl) {
          response.status(404).json(apiError("PRONUNCIATION_NOT_FOUND", "Recorded pronunciation was not found"));
          return;
        }
        let audioUrl: URL;
        try {
          audioUrl = new URL(entry.audioUrl);
        } catch {
          response.status(404).json(apiError("PRONUNCIATION_NOT_FOUND", "Recorded pronunciation was not found"));
          return;
        }
        if (audioUrl.protocol !== "https:") {
          response.status(404).json(apiError("PRONUNCIATION_NOT_FOUND", "Recorded pronunciation was not found"));
          return;
        }
        response.setHeader("Cache-Control", "public, max-age=86400");
        response.redirect(302, audioUrl.toString());
      } catch (error) {
        next(error);
      }
    },
  );

  app.get(
    "/api/pronunciations/:word",
    enforceWordSuggestionRateLimit,
    async (request, response, next) => {
      const rawWord = request.params.word;
      const word = typeof rawWord === "string" ? normalizeWord(rawWord) : "";
      if (!isValidWordQuery(word)) {
        response.status(400).json(apiError("INVALID_WORD", "Word query is invalid"));
        return;
      }
      const rawAccent = request.query.accent;
      if (rawAccent !== undefined && rawAccent !== "gb" && rawAccent !== "us") {
        response.status(400).json(apiError("INVALID_ACCENT", "Accent must be gb or us"));
        return;
      }
      const accent = rawAccent === "us" ? "us" : "gb";
      const pronunciationLookup = accent === "us" ? pronunciationLookupUs : pronunciationLookupGb;
      try {
        const entry = await pronunciationLookup.lookup(dictionaryHeadword(word));
        if (!entry || (!entry.phonetic && !entry.audioUrl)) {
          response.status(404).json(apiError("PRONUNCIATION_NOT_FOUND", "Pronunciation was not found"));
          return;
        }
        response.setHeader("Cache-Control", "public, max-age=86400");
        response.status(200).json({
          word,
          accent,
          phonetic: entry.phonetic,
          ...(entry.audioUrl ? { audioUrl: entry.audioUrl } : {}),
        });
      } catch (error) {
        next(error);
      }
    },
  );

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
          const identity = identityOf(response);
          const canReadPersonal = identity.clientId && (identity.user || !identity.headerClaimedBy);
          const personal = canReadPersonal ? await studyStore.findPersonalWord(identity.clientId!, word) : null;
          if (personal) {
            response.setHeader("Cache-Control", "private, no-store");
            response.status(200).json(personal);
            return;
          }
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
    if (!identityOf(response).user) {
      response.status(401).json(apiError("AUTH_REQUIRED_FOR_UPLOAD", "Sign in to manage uploaded wordbooks"));
      return;
    }
    try { response.status(200).json(await studyStore.listUploads(clientId)); } catch (error) { next(error); }
  });
  app.get("/api/catalog/wordbooks/:id/summary", async (request, response, next) => {
    const clientId = readClientId(request, response); const id = parseResourceId(request.params.id);
    if (!clientId) return;
    if (!id) { response.status(400).json(apiError("INVALID_RESOURCE_ID", "Resource id is invalid")); return; }
    try { const book = await studyStore.getCatalogSummary(clientId, id); if (!book) response.status(404).json(apiError("CATALOG_NOT_FOUND", "Catalog wordbook was not found")); else response.status(200).json(book); } catch (error) { next(error); }
  });
  app.get("/api/catalog/wordbooks/:id/words", async (request, response, next) => {
    const clientId = readClientId(request, response); const id = parseResourceId(request.params.id); const query = parseCatalogWordsQuery(request.query);
    if (!clientId) return;
    if (!id || !query) { response.status(400).json(apiError("INVALID_CATALOG_WORDS_QUERY", "Catalog words query is invalid")); return; }
    try { const page = await studyStore.listCatalogWords(clientId, id, query); if (!page) response.status(404).json(apiError("CATALOG_NOT_FOUND", "Catalog wordbook was not found")); else response.status(200).json(page); } catch (error) { next(error); }
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
    const clientId = readClientId(request, response);
    if (!clientId) return;
    const user = identityOf(response).user;
    if (!user) {
      response.status(401).json(apiError("AUTH_REQUIRED_FOR_UPLOAD", "Sign in before uploading a wordbook"));
      return;
    }
    const input = parseUploadCatalog(request.body);
    if (!input) { response.status(400).json(apiError("INVALID_CATALOG_UPLOAD", "Catalog upload is invalid")); return; }
    try {
      if (input.sourceWordbookId && input.title === undefined) {
        const source = await studyStore.getMyWordbook(clientId, input.sourceWordbookId);
        if (!source) { response.status(404).json(apiError("WORDBOOK_NOT_FOUND", "Source wordbook was not found")); return; }
        if (!isCatalogTitle(source.title)) { response.status(400).json(apiError("INVALID_CATALOG_UPLOAD", "Catalog title must be 40 characters or fewer")); return; }
      }
      const catalog = await studyStore.uploadCatalog(clientId, {
        ...input,
        author: { userId: user.id, username: user.username },
      });
      if (!catalog) response.status(404).json(apiError("WORDBOOK_NOT_FOUND", "Source wordbook was not found")); else response.status(201).json(catalog);
    } catch (error) { next(error); }
  });
  const updateCatalogSnapshot: RequestHandler = async (request, response, next) => {
    const clientId = readClientId(request, response); const id = parseResourceId(request.params.id); const input = parseUpdateCatalog(request.body);
    if (!clientId) return;
    if (!id) { response.status(400).json(apiError("INVALID_RESOURCE_ID", "Resource id is invalid")); return; }
    if (!input) { response.status(400).json(apiError("INVALID_CATALOG_UPLOAD", "Catalog update is invalid")); return; }
    const user = identityOf(response).user;
    if (!user) {
      response.status(401).json(apiError("AUTH_REQUIRED_FOR_UPLOAD", "Sign in to update an uploaded wordbook"));
      return;
    }
    try {
      const result = await studyStore.updateCatalog(clientId, id, {
        ...input,
        author: { userId: user.id, username: user.username },
      });
      if (result.kind === "updated") {
        response.status(200).json(result.catalog);
      } else if (result.kind === "not-found") {
        response.status(404).json(apiError("CATALOG_NOT_FOUND", "Catalog wordbook or source wordbook was not found"));
      } else if (result.kind === "head-required") {
        response.status(409).json({
          ...apiError("CATALOG_HEAD_REQUIRED", "Refresh the upload before publishing a new snapshot"),
          headRevisionId: result.headRevisionId,
        });
      } else if (result.kind === "stale") {
        response.status(409).json({
          ...apiError("CATALOG_HEAD_STALE", "The public wordbook changed; preview the snapshot again"),
          headRevisionId: result.headRevisionId,
        });
      } else if (result.kind === "open-contributions") {
        response.status(409).json({
          ...apiError("CATALOG_OPEN_CONTRIBUTIONS", "Resolve open contributions before changing visibility"),
          openContributionCount: result.openContributionCount,
        });
      } else {
        response.status(409).json({
          ...apiError("CATALOG_SOURCE_MISMATCH", "The upload is already linked to another active source wordbook"),
          headRevisionId: result.headRevisionId,
          sourceWordbookId: result.sourceWordbookId,
        });
      }
    } catch (error) { next(error); }
  };
  app.patch("/api/catalog/wordbooks/:id", updateCatalogSnapshot);
  app.put("/api/catalog/wordbooks/:id", updateCatalogSnapshot);
  app.delete("/api/catalog/wordbooks/:id", async (request, response, next) => {
    const clientId = readClientId(request, response); const id = parseResourceId(request.params.id);
    if (!clientId) return;
    if (!id) { response.status(400).json(apiError("INVALID_RESOURCE_ID", "Resource id is invalid")); return; }
    try { if (!await studyStore.deleteCatalogUpload(clientId, id)) response.status(404).json(apiError("CATALOG_NOT_FOUND", "Catalog wordbook was not found")); else response.status(204).end(); } catch (error) { next(error); }
  });
  app.get("/api/my/wordbooks/:id/contribution-preview", async (request, response, next) => {
    const clientId = readClientId(request, response);
    const wordbookId = parseResourceId(request.params.id);
    if (!clientId) return;
    if (!wordbookId) {
      response.status(400).json(apiError("INVALID_RESOURCE_ID", "Resource id is invalid"));
      return;
    }
    const user = identityOf(response).user;
    if (!user) {
      response.status(401).json(apiError("AUTH_REQUIRED", "Sign in before submitting an improvement"));
      return;
    }
    try {
      const preview = await studyStore.getContributionPreview(clientId, user.id, wordbookId);
      if (!preview) response.status(404).json(apiError("CONTRIBUTION_PREVIEW_UNAVAILABLE", "This wordbook cannot submit improvements"));
      else response.status(200).json(preview);
    } catch (error) { next(error); }
  });
  app.post("/api/catalog/wordbooks/:id/contributions", async (request, response, next) => {
    const clientId = readClientId(request, response);
    const catalogId = parseResourceId(request.params.id);
    const input = parseCreateCatalogContribution(request.body);
    if (!clientId) return;
    if (!catalogId || !input) {
      response.status(400).json(apiError("INVALID_CONTRIBUTION", "Contribution title, description, or expected version is invalid"));
      return;
    }
    const user = identityOf(response).user;
    if (!user) {
      response.status(401).json(apiError("AUTH_REQUIRED", "Sign in before submitting an improvement"));
      return;
    }
    try {
      sendContributionMutation(response, await studyStore.createContribution(
        clientId,
        { userId: user.id, username: user.username },
        catalogId,
        input,
      ));
    } catch (error) { next(error); }
  });
  app.get("/api/catalog/wordbooks/:id/contributions", async (request, response, next) => {
    const clientId = readClientId(request, response);
    const catalogId = parseResourceId(request.params.id);
    const query = parseCursorQuery(request.query);
    if (!clientId) return;
    if (!catalogId || !query) {
      response.status(400).json(apiError("INVALID_CONTRIBUTION_QUERY", "Contribution query is invalid"));
      return;
    }
    try {
      const page = await studyStore.listCatalogContributions(
        clientId,
        identityOf(response).user?.id,
        catalogId,
        query,
      );
      if (!page) response.status(404).json(apiError("CATALOG_NOT_FOUND", "Catalog wordbook was not found"));
      else response.status(200).json(page);
    } catch (error) { next(error); }
  });
  app.get("/api/catalog/wordbooks/:id/contributions/:contributionId", async (request, response, next) => {
    const clientId = readClientId(request, response);
    const catalogId = parseResourceId(request.params.id);
    const contributionId = parseResourceId(request.params.contributionId);
    if (!clientId) return;
    if (!catalogId || !contributionId) {
      response.status(400).json(apiError("INVALID_RESOURCE_ID", "Resource id is invalid"));
      return;
    }
    try {
      const contribution = await studyStore.getCatalogContribution(
        clientId,
        identityOf(response).user?.id,
        catalogId,
        contributionId,
      );
      if (!contribution) response.status(404).json(apiError("CONTRIBUTION_NOT_FOUND", "Contribution was not found"));
      else response.status(200).json(contribution);
    } catch (error) { next(error); }
  });
  app.post("/api/catalog/wordbooks/:id/contributions/:contributionId/merge", async (request, response, next) => {
    const clientId = readClientId(request, response);
    const catalogId = parseResourceId(request.params.id);
    const contributionId = parseResourceId(request.params.contributionId);
    const input = parseResolveCatalogContribution(request.body);
    if (!clientId) return;
    if (!catalogId || !contributionId || !input) {
      response.status(400).json(apiError("INVALID_CONTRIBUTION_RESOLUTION", "Contribution resolution is invalid"));
      return;
    }
    const user = identityOf(response).user;
    if (!user) {
      response.status(401).json(apiError("AUTH_REQUIRED", "Sign in to merge a contribution"));
      return;
    }
    try {
      sendContributionMutation(response, await studyStore.mergeContribution(
        clientId,
        { userId: user.id, username: user.username },
        catalogId,
        contributionId,
        input,
      ));
    } catch (error) { next(error); }
  });
  app.post("/api/catalog/wordbooks/:id/contributions/:contributionId/close", async (request, response, next) => {
    const clientId = readClientId(request, response);
    const catalogId = parseResourceId(request.params.id);
    const contributionId = parseResourceId(request.params.contributionId);
    const input = parseResolveCatalogContribution(request.body);
    if (!clientId) return;
    if (!catalogId || !contributionId || !input) {
      response.status(400).json(apiError("INVALID_CONTRIBUTION_RESOLUTION", "Contribution resolution is invalid"));
      return;
    }
    const user = identityOf(response).user;
    if (!user) {
      response.status(401).json(apiError("AUTH_REQUIRED", "Sign in to close a contribution"));
      return;
    }
    try {
      sendContributionMutation(response, await studyStore.closeContribution(
        clientId,
        { userId: user.id, username: user.username },
        catalogId,
        contributionId,
        input,
      ));
    } catch (error) { next(error); }
  });
  app.get("/api/catalog/wordbooks/:id/revisions", async (request, response, next) => {
    const clientId = readClientId(request, response);
    const catalogId = parseResourceId(request.params.id);
    const query = parseCursorQuery(request.query);
    if (!clientId) return;
    if (!catalogId || !query) {
      response.status(400).json(apiError("INVALID_REVISION_QUERY", "Revision query is invalid"));
      return;
    }
    try {
      const page = await studyStore.listCatalogRevisions(
        clientId,
        identityOf(response).user?.id,
        catalogId,
        query,
      );
      if (!page) response.status(404).json(apiError("CATALOG_NOT_FOUND", "Catalog wordbook was not found"));
      else response.status(200).json(page);
    } catch (error) { next(error); }
  });
  app.get("/api/catalog/wordbooks/:id/revisions/:revisionId", async (request, response, next) => {
    const clientId = readClientId(request, response);
    const catalogId = parseResourceId(request.params.id);
    const revisionId = parseResourceId(request.params.revisionId);
    if (!clientId) return;
    if (!catalogId || !revisionId) {
      response.status(400).json(apiError("INVALID_RESOURCE_ID", "Resource id is invalid"));
      return;
    }
    try {
      const revision = await studyStore.getCatalogRevision(
        clientId,
        identityOf(response).user?.id,
        catalogId,
        revisionId,
      );
      if (!revision) response.status(404).json(apiError("REVISION_NOT_FOUND", "Revision was not found"));
      else response.status(200).json(revision);
    } catch (error) { next(error); }
  });
  app.get("/api/catalog/wordbooks/:id/revisions/:revisionId/revert-preview", async (request, response, next) => {
    const clientId = readClientId(request, response);
    const catalogId = parseResourceId(request.params.id);
    const revisionId = parseResourceId(request.params.revisionId);
    if (!clientId) return;
    if (!catalogId || !revisionId) {
      response.status(400).json(apiError("INVALID_RESOURCE_ID", "Resource id is invalid"));
      return;
    }
    const user = identityOf(response).user;
    if (!user) {
      response.status(401).json(apiError("AUTH_REQUIRED", "Sign in to preview a revert"));
      return;
    }
    try {
      const preview = await studyStore.getRevertPreview(clientId, user.id, catalogId, revisionId);
      if (!preview) response.status(404).json(apiError("REVISION_NOT_FOUND", "Revision was not found or cannot be reverted"));
      else response.status(200).json(preview);
    } catch (error) { next(error); }
  });
  app.post("/api/catalog/wordbooks/:id/revisions/:revisionId/revert", async (request, response, next) => {
    const clientId = readClientId(request, response);
    const catalogId = parseResourceId(request.params.id);
    const revisionId = parseResourceId(request.params.revisionId);
    const input = parseRevertRevision(request.body);
    if (!clientId) return;
    if (!catalogId || !revisionId || !input) {
      response.status(400).json(apiError("INVALID_REVISION_REVERT", "Revert request is invalid"));
      return;
    }
    const user = identityOf(response).user;
    if (!user) {
      response.status(401).json(apiError("AUTH_REQUIRED", "Sign in to revert a revision"));
      return;
    }
    try {
      sendRevisionMutation(response, await studyStore.revertRevision(
        clientId,
        { userId: user.id, username: user.username },
        catalogId,
        revisionId,
        input,
      ));
    } catch (error) { next(error); }
  });
  app.get("/api/account/contributions", async (request, response, next) => {
    const clientId = readClientId(request, response);
    const scope = request.query.scope === "review" || request.query.scope === "authored"
      ? request.query.scope
      : null;
    const query = parseCursorQuery(request.query);
    if (!clientId) return;
    if (!scope || !query) {
      response.status(400).json(apiError("INVALID_CONTRIBUTION_QUERY", "Contribution inbox query is invalid"));
      return;
    }
    const user = identityOf(response).user;
    if (!user) {
      response.status(401).json(apiError("AUTH_REQUIRED", "Sign in to view contribution inbox"));
      return;
    }
    try {
      response.status(200).json(await studyStore.listAccountContributions(clientId, user.id, scope, query));
    } catch (error) { next(error); }
  });
  app.post("/api/catalog/imports", async (request, response, next) => {
    const clientId = readClientId(request, response); const shareCode = parseShareCode(request.body && typeof request.body === "object" ? (request.body as { shareCode?: unknown }).shareCode : undefined);
    if (!clientId) return;
    if (!shareCode) { response.status(400).json(apiError("INVALID_SHARE_CODE", "Share code is invalid")); return; }
    try { const result = await studyStore.importShareCode(clientId, shareCode); if (!result) response.status(404).json(apiError("SHARE_CODE_NOT_FOUND", "Share code was not found")); else response.status(result.created ? 201 : 200).json(result); } catch (error) { next(error); }
  });
  app.get("/api/my/study-settings", async (request, response, next) => {
    const clientId = readClientId(request, response);
    if (!clientId) return;
    try { response.status(200).json({ settings: await studyStore.getStudySettings(clientId) }); } catch (error) { next(error); }
  });
  app.patch("/api/my/study-settings", async (request, response, next) => {
    const clientId = readClientId(request, response); const input = parseUpdateStudySettings(request.body);
    if (!clientId) return;
    if (!input) { response.status(400).json(apiError("INVALID_STUDY_SETTINGS", "Study settings are invalid")); return; }
    try { response.status(200).json(await studyStore.updateStudySettings(clientId, input)); } catch (error) { next(error); }
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
  app.patch("/api/my/wordbooks/:id", async (request, response, next) => {
    const clientId = readClientId(request, response); const id = parseResourceId(request.params.id); const input = parseUpdateMyWordbook(request.body);
    if (!clientId) return;
    if (!id || !input) { response.status(400).json(apiError("INVALID_WORDBOOK_UPDATE", "Wordbook update is invalid")); return; }
    try { const book = await studyStore.updateMyWordbook(clientId, id, input); if (!book) response.status(404).json(apiError("WORDBOOK_NOT_FOUND", "Wordbook was not found")); else response.status(200).json(book); } catch (error) { next(error); }
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
  app.delete("/api/my/wordbooks/:id/purge", async (request, response, next) => {
    const clientId = readClientId(request, response); const id = parseResourceId(request.params.id);
    if (!clientId) return;
    if (!id) { response.status(400).json(apiError("INVALID_RESOURCE_ID", "Resource id is invalid")); return; }
    try { if (!await studyStore.purgeMyWordbook(clientId, id)) response.status(404).json(apiError("WORDBOOK_NOT_FOUND", "Wordbook was not found")); else response.status(204).end(); } catch (error) { next(error); }
  });
  app.post("/api/my/wordbooks/:id/words", async (request, response, next) => {
    const clientId = readClientId(request, response); const wordbookId = parseResourceId(request.params.id); const input = parseAddWord(request.body);
    if (!clientId) return;
    if (!wordbookId) { response.status(400).json(apiError("INVALID_RESOURCE_ID", "Resource id is invalid")); return; }
    if (!input) { response.status(400).json(apiError("INVALID_WORD", "Word is invalid")); return; }
    try {
      // Resolve dictionary data the same way import does; a transient lookup failure
      // still yields an entry (empty phonetic/meanings) so adding never blocks.
      const prepared = await resolveOneImportLine({ line: 1, word: input.word, ...(input.zhMeaning ? { zhMeaning: input.zhMeaning } : {}) });
      const result = await studyStore.addWordToMyWordbook(clientId, wordbookId, prepared.entry!);
      if (!result) response.status(404).json(apiError("WORDBOOK_NOT_FOUND", "Wordbook was not found"));
      else response.status(result.created ? 201 : 200).json({ word: result.word });
    } catch (error) { next(error); }
  });
  app.get("/api/my/wordbooks/:id/words", async (request, response, next) => {
    const clientId = readClientId(request, response); const id = parseResourceId(request.params.id); const status = parseStatus(request.query.status);
    if (!clientId) return;
    if (!id || status === null) { response.status(400).json(apiError("INVALID_QUEUE_QUERY", "Queue query is invalid")); return; }
    try { const words = await studyStore.listWords(clientId, id, status); if (!words) response.status(404).json(apiError("WORDBOOK_NOT_FOUND", "Wordbook was not found")); else response.status(200).json(words); } catch (error) { next(error); }
  });
  app.get("/api/my/wordbooks/:id/words/page", async (request, response, next) => {
    const clientId = readClientId(request, response); const id = parseResourceId(request.params.id); const query = parseMyWordbookWordsQuery(request.query);
    if (!clientId) return;
    if (!id || !query) { response.status(400).json(apiError("INVALID_WORD_PAGE_QUERY", "Word page query is invalid")); return; }
    try { const page = await studyStore.listWordPage(clientId, id, query); if (!page) response.status(404).json(apiError("WORDBOOK_NOT_FOUND", "Wordbook was not found")); else response.status(200).json(page); } catch (error) { next(error); }
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
  app.post("/api/my/wordbooks/:id/words/batch", async (request, response, next) => {
    const clientId = readClientId(request, response);
    const wordbookId = parseResourceId(request.params.id);
    const input = parseBatchWords(request.body);
    if (!clientId) return;
    if (!wordbookId || !input) {
      response.status(400).json(apiError("INVALID_BATCH_WORD_ACTION", "Batch word action is invalid"));
      return;
    }
    try {
      let rematched: Record<string, StudyWordEntry> | undefined;
      if (input.action === "refresh-meanings") {
        const words = await studyStore.listWords(clientId, wordbookId);
        if (!words) {
          response.status(404).json(apiError("WORDBOOK_NOT_FOUND", "Wordbook was not found"));
          return;
        }
        const requested = new Set(input.wordIds);
        const matches = await Promise.all(words.filter((word) => requested.has(word.id)).map(async (word) => {
          const prepared = await resolveOneImportLine({ line: 1, word: word.word });
          return prepared.status !== "ready" || !prepared.entry
            ? null
            : [word.id, prepared.entry] as const;
        }));
        rematched = Object.fromEntries(matches.filter((match): match is readonly [string, StudyWordEntry] => match !== null));
      }
      const result = await studyStore.batchWords(clientId, wordbookId, { ...input, ...(rematched ? { rematched } : {}) });
      if (!result) response.status(404).json(apiError("WORDBOOK_NOT_FOUND", "Wordbook was not found"));
      else response.status(200).json(result);
    } catch (error) { next(error); }
  });
  app.get("/api/my/import-drafts", async (request, response, next) => {
    const clientId = readClientId(request, response); if (!clientId) return;
    try { response.status(200).json((await studyStore.listImportDrafts(clientId)).map((draft) => withDraftQueueState(clientId, draft))); } catch (error) { next(error); }
  });
  app.get("/api/my/import-drafts/status", async (request, response, next) => {
    const clientId = readClientId(request, response); if (!clientId) return;
    try {
      const summaries = await studyStore.listImportDraftTaskSummaries(clientId);
      response.status(200).json(summaries.map((task) => task.nextProcessingDraftId && draftQueueState(clientId, task.nextProcessingDraftId) ? { ...task, queued: true } : task));
    } catch (error) { next(error); }
  });
  app.post("/api/my/import-drafts", async (request, response, next) => {
    const clientId = readClientId(request, response); const input = parseCreateImportDraft(request.body);
    if (!clientId) return;
    if (!input) { response.status(400).json(apiError("INVALID_IMPORT_DRAFT", "Import draft is invalid or exceeds the 10,000-row limit")); return; }
    try {
      const drafts = await studyStore.createImportDrafts(clientId, input);
      if (!drafts[0]) response.status(404).json(apiError("WORDBOOK_NOT_FOUND", "Target wordbook was not found"));
      else {
        for (const draft of drafts) void processImportDraft(clientId, draft.id);
        response.status(201).json(withDraftQueueState(clientId, drafts[0]));
      }
    } catch (error) { next(error); }
  });
  app.get("/api/my/import-drafts/:id", async (request, response, next) => {
    const clientId = readClientId(request, response); const id = parseResourceId(request.params.id); if (!clientId) return;
    if (!id) { response.status(400).json(apiError("INVALID_RESOURCE_ID", "Resource id is invalid")); return; }
    try { const draft = await studyStore.getImportDraft(clientId, id); if (!draft) response.status(404).json(apiError("IMPORT_DRAFT_NOT_FOUND", "Import draft was not found")); else response.status(200).json(withDraftQueueState(clientId, draft)); } catch (error) { next(error); }
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
      const group = (await studyStore.listImportDrafts(clientId)).filter((item) => item.groupId === draft.groupId);
      if (group.length !== draft.totalBatches) {
        response.status(409).json(apiError("IMPORT_DRAFT_GROUP_INCOMPLETE", "One or more import batches are missing"));
        return;
      }
      if (group.some((item) => item.status === "processing")) { response.status(409).json(apiError("IMPORT_DRAFT_PROCESSING", "Import draft group is still matching dictionary data")); return; }
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
      // A manual/browser resume is the second attempt. If the dictionary is still
      // unavailable, keep the user's raw entry and let the import reach confirmation.
      void processImportDraft(clientId, id, true);
      response.status(202).json(withDraftQueueState(clientId, draft));
    } catch (error) { next(error); }
  });
  app.post("/api/study/rounds", async (request, response, next) => {
    const clientId = readClientId(request, response); const input = parseStartStudyRound(request.body);
    if (!clientId) return;
    if (!input) { response.status(400).json(apiError("INVALID_STUDY_ROUND", "Study round request is invalid")); return; }
    try {
      const result = await studyStore.startStudyRound(clientId, input);
      if (!result) response.status(404).json(apiError("WORDBOOK_NOT_FOUND", "Wordbook was not found"));
      else response.status(result.resumed ? 200 : 201).json(result);
    } catch (error) { next(error); }
  });
  app.get("/api/study/rounds/:id", async (request, response, next) => {
    const clientId = readClientId(request, response); const id = parseWordId(request.params.id);
    if (!clientId) return;
    if (!id) { response.status(400).json(apiError("INVALID_STUDY_ROUND", "Study round id is invalid")); return; }
    try {
      const round = await studyStore.getStudyRound(clientId, id);
      if (!round) response.status(404).json(apiError("STUDY_ROUND_NOT_FOUND", "Study round was not found or has expired"));
      else response.status(200).json(round);
    } catch (error) { next(error); }
  });
  app.get("/api/study/rounds/:id/tasks/:taskId/options", async (request, response, next) => {
    const clientId = readClientId(request, response);
    const id = parseWordId(request.params.id);
    const taskId = parseWordId(request.params.taskId);
    const rawMeaningPreference = request.query.meaningPreference;
    if (!clientId) return;
    if (
      !id
      || !taskId
      || (rawMeaningPreference !== undefined && rawMeaningPreference !== "zh" && rawMeaningPreference !== "en")
    ) {
      response.status(400).json(apiError("INVALID_STUDY_TASK", "Study task id or meaning preference is invalid"));
      return;
    }
    try {
      const options = await studyStore.getStudyRoundTaskOptions(
        clientId,
        id,
        taskId,
        rawMeaningPreference,
      );
      if (!options) response.status(404).json(apiError("STUDY_TASK_NOT_FOUND", "The active meaning-choice task was not found"));
      else response.status(200).json(options);
    } catch (error) { next(error); }
  });
  app.post("/api/study/rounds/:id/rotate", async (request, response, next) => {
    const clientId = readClientId(request, response);
    const id = parseWordId(request.params.id);
    const revision = parseStudyRoundRevision(request.body);
    if (!clientId) return;
    if (!id || revision === null) { response.status(400).json(apiError("INVALID_STUDY_ROUND", "Study round revision is invalid")); return; }
    try {
      const result = await studyStore.rotateStudyRound(clientId, id, revision);
      if (result.kind === "not-found") response.status(404).json(apiError("STUDY_ROUND_NOT_FOUND", "Study round was not found or has expired"));
      else if (result.kind === "conflict") response.status(409).json({ ...apiError("STUDY_ROUND_CONFLICT", "The study round changed on another device"), round: result.round });
      else response.status(200).json(result.round);
    } catch (error) { next(error); }
  });
  app.post("/api/study/rounds/:id/answers", async (request, response, next) => {
    const clientId = readClientId(request, response);
    const id = parseWordId(request.params.id);
    const input = parseStudyRoundAnswer(request.body);
    if (!clientId) return;
    if (!id || !input) { response.status(400).json(apiError("INVALID_STUDY_ANSWER", "Study answer is invalid")); return; }
    try {
      const result = await studyStore.answerStudyRound(clientId, id, input);
      if (result.kind === "not-found") response.status(404).json(apiError("STUDY_ROUND_NOT_FOUND", "Study round was not found or has expired"));
      else if (result.kind === "conflict") response.status(409).json({ ...apiError("STUDY_ROUND_CONFLICT", "The study round changed on another device"), round: result.round });
      else response.status(200).json(result.round);
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

    if (error instanceof AuthCapacityError) {
      response.setHeader("Retry-After", "1");
      response.status(503).json(apiError("AUTH_BUSY", "Authentication is busy; retry shortly"));
      return;
    }

    if (error instanceof StudyResourceLimitError) {
      response.status(409).json(apiError("RESOURCE_LIMIT_EXCEEDED", `The ${error.resource} storage limit has been reached`));
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
