import type { CatalogQuery, CatalogWordbook } from './workspaceApi'

export type MarketplaceCatalogSnapshot = {
  catalog: CatalogWordbook[]
  uploads: CatalogWordbook[] | null
  favorites: CatalogWordbook[] | null
}

export const MARKETPLACE_CATALOG_CACHE_TTL_MS = 5 * 60 * 1_000

type CacheEntry = {
  snapshot: MarketplaceCatalogSnapshot
  cachedAt: number
}

const cache = new Map<string, CacheEntry>()
const inFlight = new Map<string, Promise<MarketplaceCatalogSnapshot>>()
let generation = 0

export function marketplaceCatalogCacheKey(clientId: string, query: CatalogQuery): string {
  return JSON.stringify({
    clientId,
    q: query.q ?? '',
    exam: query.exam ?? '',
    goal: query.goal ?? '',
    sort: query.sort ?? '',
  })
}

export function readMarketplaceCatalogCache(
  key: string,
  now = Date.now(),
): MarketplaceCatalogSnapshot | null {
  const entry = cache.get(key)
  if (!entry) return null
  if (now - entry.cachedAt >= MARKETPLACE_CATALOG_CACHE_TTL_MS) {
    cache.delete(key)
    return null
  }
  return entry.snapshot
}

export function invalidateMarketplaceCatalogCache(): void {
  generation += 1
  cache.clear()
  inFlight.clear()
}

export async function loadMarketplaceCatalogSnapshot(
  key: string,
  loader: () => Promise<MarketplaceCatalogSnapshot>,
  force = false,
): Promise<MarketplaceCatalogSnapshot> {
  if (force) invalidateMarketplaceCatalogCache()
  else {
    const cached = readMarketplaceCatalogCache(key)
    if (cached) return cached
    const pending = inFlight.get(key)
    if (pending) return pending
  }

  const requestGeneration = generation
  const request = loader().then((snapshot) => {
    if (requestGeneration === generation) cache.set(key, { snapshot, cachedAt: Date.now() })
    return snapshot
  }).finally(() => {
    if (inFlight.get(key) === request) inFlight.delete(key)
  })
  inFlight.set(key, request)
  return request
}
