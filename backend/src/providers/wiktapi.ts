import { isValidWordQuery, normalizeWord } from "../words/normalize.js";
import {
  WordProviderError,
  type WordEntry,
  type WordMeaning,
  type WordProvider,
} from "../words/types.js";

const DEFAULT_BASE_URL = "https://api.wiktapi.dev/v1/en/word";
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_MEANINGS = 8;

type JsonObject = Record<string, unknown>;

interface Pronunciation {
  phonetic: string;
  audioUrl?: string;
}

export type EnglishAccent = "gb" | "us";

export interface WiktApiProviderOptions {
  baseUrl?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  accent?: EnglishAccent;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOptionalString(object: JsonObject, key: string): string | undefined {
  const value = object[key];
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new WordProviderError("UPSTREAM_PARSE_ERROR", `WiktApi field "${key}" is invalid`);
  }

  return value.trim() || undefined;
}

function readOptionalArray(object: JsonObject, key: string): unknown[] {
  const value = object[key];
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new WordProviderError("UPSTREAM_PARSE_ERROR", `WiktApi field "${key}" is invalid`);
  }

  return value;
}

function normalizePhonetic(value: string | undefined): string {
  if (!value) {
    return "";
  }

  const inner = value.trim().replace(/^[/[]/, "").replace(/[/\]]$/, "").trim();
  return inner ? `/${inner}/` : "";
}

function toHttpsAudioUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const candidate = value.startsWith("//") ? `https:${value}` : value;

  try {
    const url = new URL(candidate);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function firstExample(container: JsonObject): string | undefined {
  for (const example of readOptionalArray(container, "examples")) {
    if (typeof example === "string" && example.trim()) {
      return example.trim();
    }

    if (isJsonObject(example)) {
      const text = readOptionalString(example, "text");
      if (text) {
        return text;
      }
    }
  }

  return undefined;
}

function appendGlosses(
  container: JsonObject,
  pos: string,
  meanings: WordMeaning[],
): void {
  const example = firstExample(container);

  for (const rawGloss of readOptionalArray(container, "glosses")) {
    if (typeof rawGloss !== "string") {
      throw new WordProviderError("UPSTREAM_PARSE_ERROR", "WiktApi gloss is invalid");
    }

    const definition = rawGloss.trim();
    if (definition && meanings.length < MAX_MEANINGS) {
      meanings.push({ pos, definition, example, sourceId: "wiktapi" });
    }
  }
}

function isBritishSound(sound: JsonObject, audioUrl: string): boolean {
  const url = audioUrl.toLowerCase();
  if (url.includes("en-gb") || url.includes("_gb_") || url.includes("/uk/")) {
    return true;
  }

  return readOptionalArray(sound, "tags").some(
    (tag) =>
      typeof tag === "string" &&
      ["uk", "british", "received-pronunciation"].includes(tag.toLowerCase()),
  );
}

function isAmericanSound(sound: JsonObject, audioUrl: string): boolean {
  const url = audioUrl.toLowerCase();
  if (url.includes("en-us") || url.includes("_us_") || url.includes("/us/")) {
    return true;
  }

  return readOptionalArray(sound, "tags").some(
    (tag) =>
      typeof tag === "string" &&
      ["us", "american", "general-american"].includes(tag.toLowerCase()),
  );
}

export function mapWiktApiDefinitionsPayload(payload: unknown): WordEntry | null {
  if (!isJsonObject(payload)) {
    throw new WordProviderError("UPSTREAM_PARSE_ERROR", "WiktApi definitions are not an object");
  }

  const word = normalizeWord(readOptionalString(payload, "word") ?? "");
  if (!isValidWordQuery(word)) {
    return null;
  }

  const definitions = readOptionalArray(payload, "definitions");
  if (definitions.length === 0) {
    return null;
  }

  const meanings: WordMeaning[] = [];

  for (const rawDefinition of definitions) {
    if (!isJsonObject(rawDefinition)) {
      throw new WordProviderError("UPSTREAM_PARSE_ERROR", "WiktApi definition is invalid");
    }

    const languageCode = readOptionalString(rawDefinition, "lang_code");
    if (languageCode && languageCode.toLowerCase() !== "en") {
      continue;
    }

    const rawPos = readOptionalString(rawDefinition, "pos");
    if (!rawPos) {
      throw new WordProviderError("UPSTREAM_PARSE_ERROR", "WiktApi definition pos is missing");
    }
    const pos = rawPos.toLowerCase();

    appendGlosses(rawDefinition, pos, meanings);

    for (const rawSense of readOptionalArray(rawDefinition, "senses")) {
      if (!isJsonObject(rawSense)) {
        throw new WordProviderError("UPSTREAM_PARSE_ERROR", "WiktApi sense is invalid");
      }
      appendGlosses(rawSense, pos, meanings);
    }
  }

  if (meanings.length === 0) {
    return null;
  }

  return {
    word,
    phonetic: "",
    meanings,
    source: "backend",
  };
}

export function mapWiktApiPronunciationPayload(
  payload: unknown,
  accent: EnglishAccent = "gb",
): Pronunciation {
  if (!isJsonObject(payload)) {
    throw new WordProviderError("UPSTREAM_PARSE_ERROR", "WiktApi full entry is not an object");
  }

  const sounds: JsonObject[] = [];
  for (const rawEntry of readOptionalArray(payload, "entries")) {
    if (!isJsonObject(rawEntry)) {
      throw new WordProviderError("UPSTREAM_PARSE_ERROR", "WiktApi entry is invalid");
    }

    const languageCode = readOptionalString(rawEntry, "lang_code");
    if (languageCode && languageCode.toLowerCase() !== "en") {
      continue;
    }

    for (const rawSound of readOptionalArray(rawEntry, "sounds")) {
      if (!isJsonObject(rawSound)) {
        throw new WordProviderError("UPSTREAM_PARSE_ERROR", "WiktApi sound is invalid");
      }
      sounds.push(rawSound);
    }
  }

  const soundDetails = sounds.map((sound) => {
    const audioUrl = toHttpsAudioUrl(readOptionalString(sound, "mp3_url"));

    return {
      phonetic: normalizePhonetic(readOptionalString(sound, "ipa")),
      audioUrl,
      accent: audioUrl
        ? isBritishSound(sound, audioUrl)
          ? "gb"
          : isAmericanSound(sound, audioUrl)
            ? "us"
            : undefined
        : undefined,
    };
  });

  const phonetic =
    soundDetails.find((sound) => sound.phonetic && sound.accent === accent)?.phonetic ??
    soundDetails.find((sound) => sound.phonetic)?.phonetic ??
    "";
  const audioUrl =
    soundDetails.find((sound) => sound.audioUrl && sound.accent === accent)?.audioUrl ??
    soundDetails.find((sound) => sound.audioUrl)?.audioUrl;

  return {
    phonetic,
    ...(audioUrl ? { audioUrl } : {}),
  };
}

function isTimeout(error: unknown, signal: AbortSignal): boolean {
  return (
    (signal.aborted &&
      signal.reason instanceof Error &&
      signal.reason.name === "TimeoutError") ||
    (error instanceof Error && error.name === "TimeoutError")
  );
}

export class WiktApiProvider implements WordProvider {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly accent: EnglishAccent;

  constructor(options: WiktApiProviderOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchFn = options.fetchFn ?? fetch;
    this.accent = options.accent ?? "gb";

    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 5_000) {
      throw new RangeError("WiktApi timeout must be an integer between 1 and 5000 ms");
    }
  }

  async lookup(word: string): Promise<WordEntry | null> {
    const query = normalizeWord(word);
    if (!isValidWordQuery(query)) {
      return null;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort(new DOMException("WiktApi request timed out", "TimeoutError"));
    }, this.timeoutMs);
    timeout.unref();

    const encodedQuery = encodeURIComponent(query);
    const requestOptions: RequestInit = {
      headers: { accept: "application/json" },
      signal: controller.signal,
    };
    const definitionsRequest = Promise.resolve().then(() =>
      this.fetchFn(`${this.baseUrl}/${encodedQuery}/definitions?lang=en`, requestOptions),
    );
    const fullEntryRequest = Promise.resolve().then(() =>
      this.fetchFn(`${this.baseUrl}/${encodedQuery}?lang=en`, requestOptions),
    );
    const pronunciationRequest = this.readOptionalPronunciation(fullEntryRequest);

    try {
      const entry = await this.readRequiredDefinitions(
        definitionsRequest,
        controller.signal,
      );
      if (!entry) {
        return null;
      }

      const pronunciation = await pronunciationRequest;
      return {
        ...entry,
        phonetic: pronunciation.phonetic,
        ...(pronunciation.audioUrl ? { audioUrl: pronunciation.audioUrl } : {}),
      };
    } finally {
      clearTimeout(timeout);
      if (!controller.signal.aborted) {
        controller.abort();
      }
    }
  }

  private async readRequiredDefinitions(
    request: Promise<Response>,
    signal: AbortSignal,
  ): Promise<WordEntry | null> {
    let response: Response;
    try {
      response = await request;
    } catch (cause) {
      if (isTimeout(cause, signal)) {
        throw new WordProviderError("UPSTREAM_TIMEOUT", "WiktApi request timed out", { cause });
      }
      throw new WordProviderError("UPSTREAM_ERROR", "WiktApi definitions request failed", {
        cause,
      });
    }

    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new WordProviderError(
        "UPSTREAM_ERROR",
        `WiktApi definitions returned HTTP ${response.status}`,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (cause) {
      if (isTimeout(cause, signal)) {
        throw new WordProviderError("UPSTREAM_TIMEOUT", "WiktApi request timed out", { cause });
      }
      throw new WordProviderError(
        "UPSTREAM_PARSE_ERROR",
        "WiktApi definitions returned invalid JSON",
        { cause },
      );
    }

    return mapWiktApiDefinitionsPayload(payload);
  }

  private async readOptionalPronunciation(request: Promise<Response>): Promise<Pronunciation> {
    try {
      const response = await request;
      if (!response.ok) {
        return { phonetic: "" };
      }

      const payload: unknown = await response.json();
      return mapWiktApiPronunciationPayload(payload, this.accent);
    } catch {
      return { phonetic: "" };
    }
  }
}
