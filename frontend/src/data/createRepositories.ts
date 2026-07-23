import { CompositeWordRepository } from './compositeWordRepository'
import { DictionaryApiRepository } from './dictionaryApiRepository'
import { IELTS_WORDS } from './ieltsWords'
import { LocalIeltsRepository } from './localIeltsRepository'
import type { WordRepository } from './wordRepository'

/**
 * Composition root for data access.
 *
 * Backend swap: when the API is ready, return
 * `new BackendWordRepository(import.meta.env.VITE_API_BASE)` here —
 * no page or component changes needed.
 */
export function createWordRepository(): WordRepository {
  return new CompositeWordRepository(
    new LocalIeltsRepository(IELTS_WORDS),
    new DictionaryApiRepository({
      baseUrl: 'https://api.dictionaryapi.dev/api/v2/entries/en',
    }),
  )
}

/** Singleton for the app's lifetime. */
export const wordRepository = createWordRepository()
