import { describe, expect, it } from 'vitest'
import { createJSONStorage } from 'zustand/middleware'
import type { WordbookItem } from '../domain/types'
import type { StorageLike } from '../lib/storage'
import { createWordbookStorage } from './wordbookStorage'

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

const ITEM: WordbookItem = {
  id: 'resilient',
  word: 'resilient',
  phonetic: '/rɪˈzɪliənt/',
  meanings: [{ pos: 'adjective', definition: 'Able to recover quickly.' }],
  source: 'local-ielts',
  addedAt: '2026-07-23T00:00:00.000Z',
}

const KEY = 'vocab-ielts:wordbook:v1'

function persisted(items: unknown[]): string {
  return JSON.stringify({ state: { items }, version: 1 })
}

describe('wordbook storage adapter', () => {
  it('stores Zustand JSON exactly once and restores it', () => {
    const localStorage = new MemoryStorage()
    const storage = createJSONStorage<{ items: WordbookItem[] }>(
      () => createWordbookStorage(localStorage),
    )

    storage?.setItem(KEY, { state: { items: [ITEM] }, version: 1 })

    expect(localStorage.getItem(KEY)).toBe(persisted([ITEM]))
    expect(storage?.getItem(KEY)).toEqual({
      state: { items: [ITEM] },
      version: 1,
    })
  })

  it('recovers values double-encoded by the previous adapter', () => {
    const localStorage = new MemoryStorage()
    const storage = createWordbookStorage(localStorage)
    localStorage.setItem(KEY, JSON.stringify(persisted([ITEM])))

    expect(JSON.parse(storage.getItem(KEY) ?? '')).toEqual({
      state: { items: [ITEM] },
      version: 1,
    })
  })

  it('drops corrupt payloads and filters invalid rows safely', () => {
    const localStorage = new MemoryStorage()
    const storage = createWordbookStorage(localStorage)

    localStorage.setItem(KEY, '{broken')
    expect(storage.getItem(KEY)).toBeNull()

    localStorage.setItem(KEY, persisted([ITEM, { id: 'incomplete' }, null]))
    expect(JSON.parse(storage.getItem(KEY) ?? '').state.items).toEqual([ITEM])
  })
})
