const STORAGE_PREFIX = 'vocab-ielts'

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export function storageKey(name: string, version: number): string {
  return `${STORAGE_PREFIX}:${name}:v${version}`
}

/**
 * Parse storage JSON, including values written by the old adapter that
 * accidentally JSON-encoded Zustand's already-serialized string twice.
 */
export function parseStorageJson(raw: string | null): unknown | null {
  if (raw === null) return null

  let value: unknown = raw
  for (let depth = 0; depth < 3 && typeof value === 'string'; depth += 1) {
    try {
      value = JSON.parse(value) as unknown
    } catch {
      return null
    }
  }

  return typeof value === 'string' ? null : value
}

/** Read + JSON-parse; returns null on missing or corrupted data. */
export function readStorage<T>(
  key: string,
  storage: StorageLike = window.localStorage,
): T | null {
  try {
    return parseStorageJson(storage.getItem(key)) as T | null
  } catch {
    return null
  }
}

/** Returns false when the value could not be persisted (quota, privacy mode). */
export function writeStorage(
  key: string,
  value: unknown,
  storage: StorageLike = window.localStorage,
): boolean {
  try {
    storage.setItem(key, JSON.stringify(value))
    return true
  } catch (error) {
    // Non-fatal: the app keeps working in memory, but callers can warn the user.
    console.warn(`无法保存 ${key} 到本地存储`, error)
    return false
  }
}

/**
 * Store a string that has already been serialized by the caller.
 * Returns false when the value could not be persisted (quota, privacy mode).
 */
export function writeStorageString(
  key: string,
  value: string,
  storage: StorageLike = window.localStorage,
): boolean {
  try {
    storage.setItem(key, value)
    return true
  } catch (error) {
    // Non-fatal: the app keeps working in memory, but callers can warn the user.
    console.warn(`无法保存 ${key} 到本地存储`, error)
    return false
  }
}

export function removeStorage(
  key: string,
  storage: StorageLike = window.localStorage,
): void {
  try {
    storage.removeItem(key)
  } catch {
    // ignore
  }
}
