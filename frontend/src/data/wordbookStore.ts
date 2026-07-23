import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { wordbookId } from '../domain/normalize'
import type { WordEntry, WordbookItem } from '../domain/types'
import { readStorage, storageKey, writeStorage } from '../lib/storage'

type WordbookState = {
  items: WordbookItem[]

  /** Add an entry; returns false when the word is already saved. */
  add: (entry: WordEntry) => boolean
  remove: (id: string) => void
  has: (idOrWord: string) => boolean
  getById: (id: string) => WordbookItem | undefined
  clear: () => void
  /** Newest-first copy. */
  list: () => WordbookItem[]
}

type PersistedWordbook = { items: WordbookItem[] }

const KEY = storageKey('wordbook', 1)

function isValidItem(value: unknown): value is WordbookItem {
  if (typeof value !== 'object' || value === null) return false
  const item = value as WordbookItem
  return (
    typeof item.id === 'string' &&
    typeof item.word === 'string' &&
    typeof item.addedAt === 'string' &&
    Array.isArray(item.meanings)
  )
}

/** Safe storage adapter: corrupted payloads reset to empty instead of crashing. */
const safeStorage = {
  getItem: (name: string) => {
    const parsed = readStorage<{ state?: PersistedWordbook }>(name)
    if (parsed?.state && Array.isArray(parsed.state.items)) {
      return JSON.stringify({
        state: { items: parsed.state.items.filter(isValidItem) },
        version: 1,
      })
    }
    if (parsed !== null) {
      // Present but unreadable shape → drop it.
      return null
    }
    return null
  },
  setItem: (name: string, value: string) => writeStorage(name, value),
  removeItem: (name: string) => {
    try {
      window.localStorage.removeItem(name)
    } catch {
      // ignore
    }
  },
}

export const useWordbook = create<WordbookState>()(
  persist(
    (set, get) => ({
      items: [],

      add: (entry) => {
        const id = wordbookId(entry.word)
        if (get().items.some((item) => item.id === id)) return false

        const item: WordbookItem = {
          ...entry,
          word: id,
          id,
          addedAt: new Date().toISOString(),
        }
        set((state) => ({ items: [item, ...state.items] }))
        return true
      },

      remove: (id) => {
        set((state) => ({ items: state.items.filter((item) => item.id !== id) }))
      },

      has: (idOrWord) => {
        const id = wordbookId(idOrWord)
        return get().items.some((item) => item.id === id)
      },

      getById: (id) => get().items.find((item) => item.id === id),

      clear: () => set({ items: [] }),

      list: () =>
        [...get().items].sort((a, b) => b.addedAt.localeCompare(a.addedAt)),
    }),
    {
      name: KEY,
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: (state) => ({ items: state.items }) as WordbookState,
    },
  ),
)

/** Selectors */
export const selectWordbookItems = (state: WordbookState) => state.items
export const selectWordbookCount = (state: WordbookState) => state.items.length
export const selectHasWord = (word: string) => (state: WordbookState) =>
  state.items.some((item) => item.id === wordbookId(word))
