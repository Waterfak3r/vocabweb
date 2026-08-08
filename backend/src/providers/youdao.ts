import { isValidWordQuery, normalizeWord } from "../words/normalize.js";
import type { WordEntry, WordProvider } from "../words/types.js";

const DEFAULT_BASE_URL = "https://dict.youdao.com/dictvoice";

export type YoudaoAccent = "gb" | "us";

export interface YoudaoPronunciationProviderOptions {
  accent?: YoudaoAccent;
  baseUrl?: string;
}
function parseBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RangeError("Youdao base URL must be a valid HTTPS URL");
  }

  if (url.protocol !== "https:") {
    throw new RangeError("Youdao base URL must use HTTPS");
  }

  return url;
}

export class YoudaoPronunciationProvider implements WordProvider {
  private readonly baseUrl: URL;
  private readonly accent: YoudaoAccent;

  constructor(options: YoudaoPronunciationProviderOptions = {}) {
    const accent = options.accent ?? "gb";
    if (accent !== "gb" && accent !== "us") {
      throw new RangeError("Youdao accent must be gb or us");
    }

    this.accent = accent;
    this.baseUrl = parseBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
  }

  async lookup(word: string): Promise<WordEntry | null> {
    const query = normalizeWord(word);
    if (!isValidWordQuery(query)) {
      return null;
    }

    const audioUrl = new URL(this.baseUrl);
    audioUrl.searchParams.set("audio", query);
    audioUrl.searchParams.set("type", this.accent === "gb" ? "1" : "2");

    return {
      word: query,
      phonetic: "",
      audioUrl: audioUrl.toString(),
      meanings: [],
      source: "backend",
    };
  }
}
