export interface WordMeaning {
  pos: string;
  definition: string;
  example?: string;
}

export interface WordEntry {
  word: string;
  phonetic: string;
  audioUrl?: string;
  meanings: WordMeaning[];
  zhMeaning?: string;
  zhMeaningSource?: "dictionary";
  availableLanguages?: Array<"zh" | "en">;
  sources?: Array<{
    id: "open_english_wordnet" | "ecdict" | "wiktapi";
    name: string;
    version: string;
    license: string;
    url: string;
  }>;
  source: "backend";
}

export interface WordProvider {
  lookup(word: string): Promise<WordEntry | null>;
}

export type WordProviderErrorCode = "UPSTREAM_ERROR" | "UPSTREAM_TIMEOUT" | "UPSTREAM_PARSE_ERROR";

export class WordProviderError extends Error {
  readonly code: WordProviderErrorCode;

  constructor(code: WordProviderErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WordProviderError";
    this.code = code;
  }
}
