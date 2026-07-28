import { storageKey } from '../lib/storage'

export type EnglishAccent = 'gb' | 'us'

export type PronunciationPreferences = {
  accent: EnglishAccent
}

export const DEFAULT_PRONUNCIATION_PREFERENCES: PronunciationPreferences = {
  accent: 'gb',
}

const KEY = storageKey('pronunciation-preferences', 1)

export function normalizePronunciationPreferences(value: unknown): PronunciationPreferences {
  if (!value || typeof value !== 'object') return { ...DEFAULT_PRONUNCIATION_PREFERENCES }
  return (value as { accent?: unknown }).accent === 'us' ? { accent: 'us' } : { accent: 'gb' }
}

export function readPronunciationPreferences(
  storage: Pick<Storage, 'getItem'> = window.localStorage,
): PronunciationPreferences {
  try {
    return normalizePronunciationPreferences(JSON.parse(storage.getItem(KEY) ?? 'null'))
  } catch {
    return { ...DEFAULT_PRONUNCIATION_PREFERENCES }
  }
}

export function writePronunciationPreferences(
  value: PronunciationPreferences,
  storage: Pick<Storage, 'setItem'> = window.localStorage,
): PronunciationPreferences {
  const normalized = normalizePronunciationPreferences(value)
  try {
    storage.setItem(KEY, JSON.stringify(normalized))
  } catch {
    // The active setting remains usable when storage is unavailable.
  }
  return normalized
}
