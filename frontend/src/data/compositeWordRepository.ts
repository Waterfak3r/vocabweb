import { isValidWordQuery, normalizeWord } from '../domain/normalize'
import type { WordEntry } from '../domain/types'
import type { WordRepository } from './wordRepository'

/**
 * Local-first lookup: curated IELTS list answers instantly and offline;
 * anything else falls through to the remote dictionary. Remote failures
 * propagate — the hook turns them into an error state.
 */
export class CompositeWordRepository implements WordRepository {
  constructor(
    private readonly local: WordRepository,
    private readonly remote: WordRepository,
  ) {}

  async lookup(word: string): Promise<WordEntry | null> {
    const query = normalizeWord(word)
    if (!isValidWordQuery(query)) return null

    const localHit = await this.local.lookup(query)
    if (localHit) return localHit

    return this.remote.lookup(query)
  }
}
