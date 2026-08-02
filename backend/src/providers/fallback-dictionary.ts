import type { WordEntry, WordProvider } from "../words/types.js";

const DEFAULT_REMOTE_FAILURE_COOLDOWN_MS = 30_000;

export interface FallbackDictionaryProviderOptions {
  remoteFailureCooldownMs?: number;
  now?: () => number;
}

/** Local data is authoritative; remote data is consulted only when English meanings are absent. */
export class FallbackDictionaryProvider implements WordProvider {
  private readonly remoteFailureCooldownMs: number;
  private readonly now: () => number;
  private remoteUnavailableUntil = 0;
  private remoteFailure: unknown;

  constructor(
    private readonly local: WordProvider,
    private readonly remote: WordProvider,
    private readonly remoteEnabled = true,
    options: FallbackDictionaryProviderOptions = {},
  ) {
    this.remoteFailureCooldownMs = options.remoteFailureCooldownMs ?? DEFAULT_REMOTE_FAILURE_COOLDOWN_MS;
    this.now = options.now ?? Date.now;
  }

  async lookup(word: string): Promise<WordEntry | null> {
    const local = await this.local.lookup(word);
    if (local?.meanings.length || !this.remoteEnabled) return local;
    if (this.now() < this.remoteUnavailableUntil) {
      if (local) return local;
      throw this.remoteFailure ?? new Error("Remote dictionary fallback is temporarily unavailable");
    }
    try {
      const remote = await this.remote.lookup(word);
      this.remoteUnavailableUntil = 0;
      this.remoteFailure = undefined;
      if (!remote) return local;
      return {
        ...remote,
        phonetic: local?.phonetic || remote.phonetic,
        ...(local?.zhMeaning ? { zhMeaning: local.zhMeaning, zhMeaningSource: "dictionary" as const } : {}),
        availableLanguages: [
          ...(local?.zhMeaning ? ["zh" as const] : []),
          "en" as const,
        ],
        sources: [
          ...(local?.sources ?? []).filter((source) => source.id === "ecdict"),
          {
            id: "wiktapi",
            name: "WiktAPI / Wiktionary",
            version: "online",
            license: "CC BY-SA 4.0 / GFDL",
            url: "https://wiktapi.dev/",
          },
        ],
      };
    } catch (error) {
      this.remoteUnavailableUntil = this.now() + this.remoteFailureCooldownMs;
      this.remoteFailure = error;
      if (local) return local;
      throw error;
    }
  }
}
