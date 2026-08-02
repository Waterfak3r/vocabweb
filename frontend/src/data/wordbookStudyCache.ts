import { readStorage, storageKey, writeStorage, type StorageLike } from '../lib/storage'
import { parseStudyDashboard, type MyWordbookWord, type StudyDashboard } from './workspaceApi'

export const WORDBOOK_DASHBOARD_CACHE_TTL_MS = 5 * 60 * 1_000
export const WORDBOOK_WORDS_CACHE_TTL_MS = 10 * 60 * 1_000
const DASHBOARD_STORAGE_KEY = storageKey('wordbook-dashboard-cache', 1)
const MAX_PERSISTED_DASHBOARDS = 50

type DashboardCacheEntry = {
  clientId: string
  wordbookId: string
  cachedAt: number
  dashboard: StudyDashboard
}

type WordsCacheEntry = {
  cachedAt: number
  words: MyWordbookWord[]
}

type PersistedDashboardCache = {
  entries: DashboardCacheEntry[]
}

const dashboardMemory = new Map<string, DashboardCacheEntry>()
const wordsMemory = new Map<string, WordsCacheEntry>()

function cacheKey(clientId: string, wordbookId: string): string {
  return JSON.stringify([clientId, wordbookId])
}

function browserStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

function sameLocalDay(left: number, right: number): boolean {
  const a = new Date(left)
  const b = new Date(right)
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
}

function dashboardIsFresh(entry: DashboardCacheEntry, now: number): boolean {
  return now >= entry.cachedAt
    && now - entry.cachedAt < WORDBOOK_DASHBOARD_CACHE_TTL_MS
    && sameLocalDay(entry.cachedAt, now)
}

function readPersistedEntries(storage: StorageLike | null): DashboardCacheEntry[] {
  if (!storage) return []
  const value = readStorage<unknown>(DASHBOARD_STORAGE_KEY, storage)
  if (!value || typeof value !== 'object' || !Array.isArray((value as PersistedDashboardCache).entries)) return []
  return (value as PersistedDashboardCache).entries.flatMap((entry) => {
    if (
      !entry
      || typeof entry !== 'object'
      || typeof entry.clientId !== 'string'
      || typeof entry.wordbookId !== 'string'
      || typeof entry.cachedAt !== 'number'
      || !Number.isFinite(entry.cachedAt)
    ) return []
    const dashboard = parseStudyDashboard(entry.dashboard)
    return dashboard && dashboard.wordbook.id === entry.wordbookId
      ? [{ clientId: entry.clientId, wordbookId: entry.wordbookId, cachedAt: entry.cachedAt, dashboard }]
      : []
  })
}

function persistEntries(entries: DashboardCacheEntry[], storage: StorageLike | null): void {
  if (!storage) return
  writeStorage(DASHBOARD_STORAGE_KEY, { entries: entries.slice(-MAX_PERSISTED_DASHBOARDS) }, storage)
}

export function readCachedWordbookDashboard(
  clientId: string,
  wordbookId: string,
  now = Date.now(),
  storage?: StorageLike,
): StudyDashboard | null {
  const key = cacheKey(clientId, wordbookId)
  const memoryEntry = dashboardMemory.get(key)
  if (memoryEntry) {
    if (dashboardIsFresh(memoryEntry, now)) return memoryEntry.dashboard
    dashboardMemory.delete(key)
  }

  const persisted = readPersistedEntries(browserStorage(storage))
  const entry = [...persisted].reverse().find(
    (candidate) => candidate.clientId === clientId && candidate.wordbookId === wordbookId,
  )
  if (!entry || !dashboardIsFresh(entry, now)) return null
  dashboardMemory.set(key, entry)
  return entry.dashboard
}

export function writeCachedWordbookDashboard(
  clientId: string,
  wordbookId: string,
  dashboard: StudyDashboard,
  cachedAt = Date.now(),
  storage?: StorageLike,
): void {
  if (dashboard.wordbook.id !== wordbookId) return
  const entry = { clientId, wordbookId, cachedAt, dashboard }
  dashboardMemory.set(cacheKey(clientId, wordbookId), entry)
  const resolvedStorage = browserStorage(storage)
  const retained = readPersistedEntries(resolvedStorage).filter(
    (candidate) => candidate.clientId !== clientId || candidate.wordbookId !== wordbookId,
  )
  persistEntries([...retained, entry], resolvedStorage)
}

export function readCachedWordbookWords(
  clientId: string,
  wordbookId: string,
  now = Date.now(),
): MyWordbookWord[] | null {
  const key = cacheKey(clientId, wordbookId)
  const entry = wordsMemory.get(key)
  if (!entry) return null
  if (now < entry.cachedAt || now - entry.cachedAt >= WORDBOOK_WORDS_CACHE_TTL_MS) {
    wordsMemory.delete(key)
    return null
  }
  return entry.words
}

export function writeCachedWordbookWords(
  clientId: string,
  wordbookId: string,
  words: MyWordbookWord[],
  cachedAt = Date.now(),
): void {
  wordsMemory.set(cacheKey(clientId, wordbookId), { words, cachedAt })
}

export function invalidateWordbookStudyCache(
  clientId: string,
  wordbookId: string,
  storage?: StorageLike,
  parts: { dashboard?: boolean; words?: boolean } = { dashboard: true, words: true },
): void {
  const key = cacheKey(clientId, wordbookId)
  if (parts.dashboard) {
    dashboardMemory.delete(key)
    const resolvedStorage = browserStorage(storage)
    persistEntries(readPersistedEntries(resolvedStorage).filter(
      (entry) => entry.clientId !== clientId || entry.wordbookId !== wordbookId,
    ), resolvedStorage)
  }
  if (parts.words) wordsMemory.delete(key)
}

export function clearAllWordbookStudyCaches(storage?: StorageLike): void {
  dashboardMemory.clear()
  wordsMemory.clear()
  const resolvedStorage = browserStorage(storage)
  if (!resolvedStorage) return
  try {
    resolvedStorage.removeItem(DASHBOARD_STORAGE_KEY)
  } catch {
    // Storage is optional; memory has already been cleared.
  }
}

/** Clears only the fast in-page layer; persisted dashboard snapshots stay available. */
export function clearWordbookStudyMemoryCache(): void {
  dashboardMemory.clear()
  wordsMemory.clear()
}
