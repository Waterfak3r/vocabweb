import { BackendWordRepository } from './backendWordRepository'
import type { WordRepository } from './wordRepository'
import {
  BackendWordSuggestionRepository,
  type WordSuggestionRepository,
} from './wordSuggestionRepository'

/**
 * Composition root for data access.
 *
 * All lookups go through our backend so privacy, rate limits, provenance, and
 * upstream policy remain server-controlled. A missing value means same-origin.
 */
export function createWordRepository(
  apiBase: string | undefined = import.meta.env.VITE_API_BASE,
): WordRepository {
  return new BackendWordRepository(apiBase?.trim() || '/')
}

/** Singleton for the app's lifetime. */
export const wordRepository = createWordRepository()

export function createWordSuggestionRepository(
  apiBase: string | undefined = import.meta.env.VITE_API_BASE,
): WordSuggestionRepository | null {
  return apiBase?.trim()
    ? new BackendWordSuggestionRepository(apiBase)
    : null
}

/** Suggestions require the indexed backend dictionary. */
export const wordSuggestionRepository = createWordSuggestionRepository()
