import { describe, expect, it } from 'vitest'
import type { StorageLike } from '../lib/storage'
import {
  DEFAULT_WORDBOOK_FILTERS,
  readWordbookFilters,
  writeWordbookFilters,
} from './wordbookFilters'

function memoryStorage(): StorageLike {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
    removeItem: (key) => { values.delete(key) },
  }
}

describe('wordbook filters', () => {
  it('persists the query, category and sort order', () => {
    const storage = memoryStorage()
    const filters = { query: '雅思', category: '考试', sort: 'progress' as const }

    expect(writeWordbookFilters(filters, storage)).toBe(true)
    expect(readWordbookFilters(storage)).toEqual(filters)
  })

  it('falls back safely when stored values are invalid', () => {
    const storage = memoryStorage()
    storage.setItem('vocab-ielts:wordbook-filters:v1', JSON.stringify({
      query: 12,
      category: 'x'.repeat(31),
      sort: 'unknown',
    }))

    expect(readWordbookFilters(storage)).toEqual(DEFAULT_WORDBOOK_FILTERS)
  })
})
