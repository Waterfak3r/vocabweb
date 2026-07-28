import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STUDY_SHORTCUTS,
  normalizeShortcutKey,
  normalizeStudyShortcuts,
  readStudyShortcuts,
  writeStudyShortcuts,
} from './studyShortcuts'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  }
}

describe('study shortcuts', () => {
  it('supports documented keys and rejects reserved or modified key names', () => {
    expect(['a', '7', 'Enter', ' ', 'Tab', 'ArrowLeft'].map(normalizeShortcutKey))
      .toEqual(['a', '7', 'enter', ' ', 'tab', 'arrowleft'])
    expect(normalizeShortcutKey('Escape')).toBeNull()
    expect(normalizeShortcutKey('F1')).toBeNull()
  })

  it('restores defaults for conflicts and reserved dictation Enter', () => {
    expect(normalizeStudyShortcuts({ ...DEFAULT_STUDY_SHORTCUTS, known: 'q' }))
      .toEqual(DEFAULT_STUDY_SHORTCUTS)
    expect(normalizeStudyShortcuts({ ...DEFAULT_STUDY_SHORTCUTS, dictationPronounce: 'Enter' }))
      .toEqual(DEFAULT_STUDY_SHORTCUTS)
  })

  it('persists one global versioned preference set', () => {
    const storage = memoryStorage()
    const custom = { ...DEFAULT_STUDY_SHORTCUTS, unknown: 'ArrowLeft' }
    writeStudyShortcuts(custom, storage)
    expect(readStudyShortcuts(storage)).toEqual({ ...custom, unknown: 'arrowleft' })
  })
})
