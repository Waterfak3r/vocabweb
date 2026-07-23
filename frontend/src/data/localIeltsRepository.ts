import { normalizeWord } from '../domain/normalize'
import type { WordEntry } from '../domain/types'
import type { WordRepository } from './wordRepository'

/** In-memory lookup over the curated IELTS list. */
export class LocalIeltsRepository implements WordRepository {
  private readonly entries: Map<string, WordEntry>

  constructor(words: readonly WordEntry[]) {
    this.entries = new Map(words.map((entry) => [entry.word, entry]))
  }

  lookup(word: string): Promise<WordEntry | null> {
    return Promise.resolve(this.entries.get(normalizeWord(word)) ?? null)
  }
}
