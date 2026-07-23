const STORAGE_PREFIX = 'vocab-ielts'

export function storageKey(name: string, version: number): string {
  return `${STORAGE_PREFIX}:${name}:v${version}`
}

/** Read + JSON-parse; returns null on missing or corrupted data. */
export function readStorage<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === null) return null
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function writeStorage(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Quota or privacy-mode failures are non-fatal: the app keeps working in memory.
  }
}

export function removeStorage(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // ignore
  }
}
