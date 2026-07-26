import { normalizeWord } from "./normalize.js";
import type { WordEntry, WordProvider } from "./types.js";

interface CacheEntry {
  /** null means a cached "not found" so repeat misses skip the upstream round-trip. */
  value: WordEntry | null;
  expiresAt: number;
}

export interface WordLookup {
  lookup(word: string): Promise<WordEntry | null>;
}

export interface WordServiceOptions {
  cacheTtlMs?: number;
  negativeCacheTtlMs?: number;
  cacheMaxEntries?: number;
  now?: () => number;
}

export class WordService implements WordLookup {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<WordEntry | null>>();
  private readonly cacheTtlMs: number;
  private readonly negativeCacheTtlMs: number;
  private readonly cacheMaxEntries: number;
  private readonly now: () => number;

  constructor(
    private readonly provider: WordProvider,
    options: WordServiceOptions = {},
  ) {
    this.cacheTtlMs = options.cacheTtlMs ?? 60 * 60 * 1_000;
    this.negativeCacheTtlMs = options.negativeCacheTtlMs ?? 5 * 60 * 1_000;
    this.cacheMaxEntries = options.cacheMaxEntries ?? 1_000;
    this.now = options.now ?? Date.now;
  }

  lookup(word: string): Promise<WordEntry | null> {
    const query = normalizeWord(word);
    const cached = this.readCache(query);
    if (cached !== undefined) {
      return Promise.resolve(cached);
    }

    const existingRequest = this.inFlight.get(query);
    if (existingRequest) {
      return existingRequest;
    }

    const request = this.provider
      .lookup(query)
      .then((entry) => {
        this.writeCache(query, entry);
        return entry;
      })
      .finally(() => {
        this.inFlight.delete(query);
      });

    this.inFlight.set(query, request);
    return request;
  }

  private readCache(key: string): WordEntry | null | undefined {
    const cached = this.cache.get(key);
    if (!cached) {
      return undefined;
    }

    if (cached.expiresAt <= this.now()) {
      this.cache.delete(key);
      return undefined;
    }

    this.cache.delete(key);
    this.cache.set(key, cached);
    return cached.value;
  }

  private writeCache(key: string, value: WordEntry | null): void {
    const now = this.now();
    for (const [cachedKey, cached] of this.cache) {
      if (cached.expiresAt <= now) {
        this.cache.delete(cachedKey);
      }
    }

    this.cache.delete(key);
    while (this.cache.size >= this.cacheMaxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      this.cache.delete(oldestKey);
    }

    this.cache.set(key, { value, expiresAt: now + (value ? this.cacheTtlMs : this.negativeCacheTtlMs) });
  }
}
