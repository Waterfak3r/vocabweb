import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { wordbookId } from '../domain/normalize'
import type { WordEntry, WordbookItem } from '../domain/types'
import { storageKey } from '../lib/storage'
import { createWordbookStorage } from './wordbookStorage'

type WordbookState = {
  items: WordbookItem[]
  /** True once a localStorage write has been lost (quota / privacy mode). */
  persistFailed: boolean

  /** Add an entry; returns false when the word is already saved. */
  add: (entry: WordEntry) => boolean
  remove: (id: string) => void
  has: (idOrWord: string) => boolean
  getById: (id: string) => WordbookItem | undefined
  clear: () => void
  /** Newest-first copy. */
  list: () => WordbookItem[]
}

const KEY = storageKey('wordbook', 1)

// Guarded so a failing persistence write of this very flag cannot loop.
function markPersistFailed() {
  if (!useWordbook.getState().persistFailed) {
    useWordbook.setState({ persistFailed: true })
  }
}

export const useWordbook = create<WordbookState>()(
  persist(
    (set, get) => ({
      items: [],
      persistFailed: false,

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
      storage: createJSONStorage(() => createWordbookStorage(window.localStorage, markPersistFailed)),
      partialize: (state) => ({ items: state.items }) as WordbookState,
    },
  ),
)

/** Selectors */
export const selectWordbookItems = (state: WordbookState) => state.items
export const selectWordbookCount = (state: WordbookState) => state.items.length
export const selectPersistFailed = (state: WordbookState) => state.persistFailed
export const selectHasWord = (word: string) => (state: WordbookState) =>
  state.items.some((item) => item.id === wordbookId(word))
