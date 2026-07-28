import { storageKey } from '../lib/storage'

export type StudyShortcutAction =
  | 'unknown'
  | 'pronounce'
  | 'known'
  | 'flip'
  | 'dictationPronounce'

export type StudyShortcutPreferences = Record<StudyShortcutAction, string>

export const DEFAULT_STUDY_SHORTCUTS: StudyShortcutPreferences = {
  unknown: 'q',
  pronounce: 'enter',
  known: 'e',
  flip: ' ',
  dictationPronounce: 'tab',
}

const KEY = storageKey('study-shortcuts', 1)
const SPECIAL = new Set(['enter', ' ', 'tab', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'])

export function normalizeShortcutKey(value: string): string | null {
  const key = value.toLocaleLowerCase()
  if (key === 'escape' || key === 'dead') return null
  if (SPECIAL.has(key) || /^[a-z0-9]$/.test(key)) return key
  return null
}

export function shortcutLabel(key: string) {
  if (key === ' ') return 'Space'
  if (key === 'enter') return 'Enter'
  if (key === 'tab') return 'Tab'
  if (key.startsWith('arrow')) return `Arrow ${key.slice(5)}`
  return key.toUpperCase()
}

export function normalizeStudyShortcuts(value: unknown): StudyShortcutPreferences {
  if (!value || typeof value !== 'object') return { ...DEFAULT_STUDY_SHORTCUTS }
  const source = value as Record<string, unknown>
  const next = { ...DEFAULT_STUDY_SHORTCUTS }
  for (const action of Object.keys(next) as StudyShortcutAction[]) {
    if (typeof source[action] === 'string') {
      const key = normalizeShortcutKey(source[action])
      if (key) next[action] = key
    }
  }
  const flashcard = [next.unknown, next.pronounce, next.known, next.flip]
  if (new Set(flashcard).size !== flashcard.length || next.dictationPronounce === 'enter') {
    return { ...DEFAULT_STUDY_SHORTCUTS }
  }
  return next
}

export function readStudyShortcuts(
  storage: Pick<Storage, 'getItem'> = window.localStorage,
): StudyShortcutPreferences {
  try {
    return normalizeStudyShortcuts(JSON.parse(storage.getItem(KEY) ?? 'null'))
  } catch {
    return { ...DEFAULT_STUDY_SHORTCUTS }
  }
}

export function writeStudyShortcuts(
  value: StudyShortcutPreferences,
  storage: Pick<Storage, 'setItem'> = window.localStorage,
) {
  const normalized = normalizeStudyShortcuts(value)
  try {
    storage.setItem(KEY, JSON.stringify(normalized))
  } catch {
    // The active in-memory settings still work when storage is unavailable.
  }
  return normalized
}
