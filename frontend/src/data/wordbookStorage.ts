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
 */
export function createWordbookStorage(storage: StorageLike) {
  return {
    getItem: (name: string): string | null => {
      const parsed = readStorage<PersistedState>(name, storage)
      if (!parsed?.state || !Array.isArray(parsed.state.items)) return null

      return JSON.stringify({
        state: { items: parsed.state.items.filter(isValidItem) },
        version: 1,
      })
    },
    setItem: (name: string, value: string): void => {
      writeStorageString(name, value, storage)
    },
    removeItem: (name: string): void => {
      removeStorage(name, storage)
    },
  }
}
