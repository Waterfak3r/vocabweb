import type { WordEntry, WordProvider } from "../words/types.js";

/** Local data is authoritative; remote data is consulted only when English meanings are absent. */
export class FallbackDictionaryProvider implements WordProvider {
  constructor(
    private readonly local: WordProvider,
    private readonly remote: WordProvider,
    private readonly remoteEnabled = true,
  ) {}

  async lookup(word: string): Promise<WordEntry | null> {
    const local = await this.local.lookup(word);
    if (local?.meanings.length || !this.remoteEnabled) return local;
    try {
      const remote = await this.remote.lookup(word);
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
      if (local) return local;
      throw error;
    }
  }
}
