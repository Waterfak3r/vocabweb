import { BackendWordRepository } from './backendWordRepository'
import { CompositeWordRepository } from './compositeWordRepository'
import { DictionaryApiRepository } from './dictionaryApiRepository'
import { IELTS_WORDS } from './ieltsWords'
import { LocalIeltsRepository } from './localIeltsRepository'
import type { WordRepository } from './wordRepository'

/**
 * Composition root for data access.
 *
 * With VITE_API_BASE configured, non-local lookups go only through our backend.
 * Without it, development keeps the existing dictionaryapi.dev fallback.
 */
export function createWordRepository(
  apiBase: string | undefined = import.meta.env.VITE_API_BASE,
): WordRepository {
  if (apiBase?.trim()) {
    // The backend already composes OEWN + ECDICT + the online miss fallback.
    // Bypassing it for the bundled IELTS sample would discard Chinese meanings
    // and source attribution for common words.
    return new BackendWordRepository(apiBase)
  }
  const remote = new DictionaryApiRepository({
    baseUrl: 'https://api.dictionaryapi.dev/api/v2/entries/en',
  })

  return new CompositeWordRepository(
    new LocalIeltsRepository(IELTS_WORDS),
    remote,
  )
}

/** Singleton for the app's lifetime. */
export const wordRepository = createWordRepository()
