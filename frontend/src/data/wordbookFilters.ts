import { readStorage, storageKey, writeStorage, type StorageLike } from '../lib/storage'

export type WordbookSort = 'updated' | 'name' | 'count' | 'progress'

export type WordbookFilters = {
  query: string
  category: string
  sort: WordbookSort
}

export const DEFAULT_WORDBOOK_FILTERS: WordbookFilters = {
  query: '',
  category: '全部',
  sort: 'updated',
}

const KEY = storageKey('wordbook-filters', 1)
const SORTS = new Set<WordbookSort>(['updated', 'name', 'count', 'progress'])

export function readWordbookFilters(
  storage: StorageLike = window.localStorage,
): WordbookFilters {
  const value = readStorage<Partial<WordbookFilters>>(KEY, storage)
  if (!value || typeof value !== 'object') return { ...DEFAULT_WORDBOOK_FILTERS }

  const query = typeof value.query === 'string' ? value.query.slice(0, 100) : ''
  const category = typeof value.category === 'string' && value.category.length <= 30
    ? value.category
    : '全部'
  const sort = typeof value.sort === 'string' && SORTS.has(value.sort as WordbookSort)
    ? value.sort as WordbookSort
    : 'updated'

  return { query, category, sort }
}

export function writeWordbookFilters(
  filters: WordbookFilters,
  storage: StorageLike = window.localStorage,
): boolean {
  return writeStorage(KEY, filters, storage)
}
