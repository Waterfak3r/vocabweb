import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceApi, type CatalogWordbook } from './workspaceApi'
import {
  invalidateMarketplaceCatalogCache,
  loadMarketplaceCatalogSnapshot,
  MARKETPLACE_CATALOG_CACHE_TTL_MS,
  marketplaceCatalogCacheKey,
  readMarketplaceCatalogCache,
  type MarketplaceCatalogSnapshot,
} from './marketplaceCatalogCache'

function catalog(id = 'catalog-1'): CatalogWordbook {
  return {
    id,
    title: '词本',
    description: '',
    author: '作者',
    exams: [],
    goals: [],
    rating: 0,
    uses: 0,
    createdAt: '2026-08-01T00:00:00.000Z',
    shareCode: 'ABCDEF12',
    wordCount: 4_000,
    favoriteCount: 0,
    favorited: false,
    added: false,
    uploaded: false,
  }
}

function snapshot(id = 'catalog-1'): MarketplaceCatalogSnapshot {
  return { catalog: [catalog(id)], uploads: [], favorites: [] }
}

afterEach(() => {
  invalidateMarketplaceCatalogCache()
  vi.useRealTimers()
})

describe('marketplace catalog cache', () => {
  it('deduplicates concurrent loads and reuses the completed snapshot on route remounts', async () => {
    const key = marketplaceCatalogCacheKey('client-1', { sort: 'hot' })
    const loader = vi.fn(async () => snapshot())

    const [first, concurrent] = await Promise.all([
      loadMarketplaceCatalogSnapshot(key, loader),
      loadMarketplaceCatalogSnapshot(key, loader),
    ])
    const reused = await loadMarketplaceCatalogSnapshot(key, loader)

    expect(loader).toHaveBeenCalledTimes(1)
    expect(concurrent).toBe(first)
    expect(reused).toBe(first)
  })

  it('separates users and filters, expires old data, and supports explicit refresh', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-02T00:00:00.000Z'))
    const hotKey = marketplaceCatalogCacheKey('client-1', { sort: 'hot' })
    const newestKey = marketplaceCatalogCacheKey('client-1', { sort: 'newest' })
    const otherUserKey = marketplaceCatalogCacheKey('client-2', { sort: 'hot' })
    expect(newestKey).not.toBe(hotKey)
    expect(otherUserKey).not.toBe(hotKey)

    const first = await loadMarketplaceCatalogSnapshot(hotKey, async () => snapshot('old'))
    const refreshed = await loadMarketplaceCatalogSnapshot(hotKey, async () => snapshot('fresh'), true)
    expect(first.catalog[0]?.id).toBe('old')
    expect(refreshed.catalog[0]?.id).toBe('fresh')

    vi.advanceTimersByTime(MARKETPLACE_CATALOG_CACHE_TTL_MS)
    expect(readMarketplaceCatalogCache(hotKey)).toBeNull()
  })

  it('invalidates cached shelves after a successful marketplace mutation', async () => {
    const key = marketplaceCatalogCacheKey('client-1', { sort: 'hot' })
    await loadMarketplaceCatalogSnapshot(key, async () => snapshot())
    const api = new WorkspaceApi('https://api.example.test/', {
      clientId: () => 'client-1',
      fetch: async () => new Response(JSON.stringify({ favorited: true, favoriteCount: 1 })),
    })

    await api.toggleFavorite('catalog-1')

    expect(readMarketplaceCatalogCache(key)).toBeNull()
  })
})
