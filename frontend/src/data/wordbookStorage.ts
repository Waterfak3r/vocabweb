import { wordbookId } from '../domain/normalize'
import type { WordbookItem, WordMeaning, WordSource } from '../domain/types'
import {
  readStorage,
  removeStorage,
  writeStorageString,
  type StorageLike,
} from '../lib/storage'

type PersistedWordbook = { items: WordbookItem[] }
type PersistedState = {
  state?: PersistedWordbook
  version?: number
}

const WORD_SOURCES = new Set<WordSource>([
  'local-ielts',
  'dictionary-api',
  'user',
  'backend',
])

function isValidMeaning(value: unknown): value is WordMeaning {
  if (typeof value !== 'object' || value === null) return false
  const meaning = value as WordMeaning
  return (
    typeof meaning.pos === 'string' &&
    typeof meaning.definition === 'string' &&
    (meaning.example === undefined || typeof meaning.example === 'string')
  )
}

function isValidItem(value: unknown): value is WordbookItem {
  if (typeof value !== 'object' || value === null) return false
  const item = value as WordbookItem
  return (
    typeof item.id === 'string' &&
    typeof item.word === 'string' &&
    typeof item.phonetic === 'string' &&
    typeof item.addedAt === 'string' &&
    typeof item.source === 'string' &&
    WORD_SOURCES.has(item.source as WordSource) &&
    (item.audioUrl === undefined || typeof item.audioUrl === 'string') &&
    Array.isArray(item.meanings) &&
    item.meanings.length > 0 &&
    item.meanings.every(isValidMeaning)
  )
}

/**
 * Zustand's JSON storage expects raw JSON strings. This adapter keeps writes
 * single-encoded and sanitizes both current and legacy double-encoded values.
 * `onWriteError` fires when a write is lost (quota, privacy mode) so the UI
 * can tell the user their words are no longer being saved.
 */
export function createWordbookStorage(storage: StorageLike, onWriteError?: () => void) {
  return {
    getItem: (name: string): string | null => {
      const parsed = readStorage<PersistedState>(name, storage)
      if (!parsed?.state || !Array.isArray(parsed.state.items)) return null

      // Re-normalize legacy items saved before curly-apostrophe folding so
      // stored ids keep matching wordbookId() lookups; drop fold collisions.
      const seen = new Set<string>()
      const items = parsed.state.items
        .filter(isValidItem)
        .map((item) => {
          const word = wordbookId(item.word)
          return word === item.word && item.id === word ? item : { ...item, word, id: word }
        })
        .filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)))

      return JSON.stringify({
        state: { items },
        version: 1,
      })
    },
    setItem: (name: string, value: string): void => {
      if (!writeStorageString(name, value, storage)) onWriteError?.()
    },
    removeItem: (name: string): void => {
      removeStorage(name, storage)
    },
  }
}
