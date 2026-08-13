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

  it('defaults unknown, vague and known to 1, 2 and 3', () => {
    expect(DEFAULT_STUDY_SHORTCUTS).toMatchObject({
      unknown: '1',
      vague: '2',
      known: '3',
      pronounce: 'tab',
    })
    expect(normalizeStudyShortcuts(null)).toEqual(DEFAULT_STUDY_SHORTCUTS)
  })

  it('restores defaults for conflicts and reserved dictation Enter', () => {
    expect(normalizeStudyShortcuts({ ...DEFAULT_STUDY_SHORTCUTS, known: '1' }))
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

  it('adds a non-conflicting mastered key to legacy preferences', () => {
    const legacy = {
      unknown: 'q', vague: 'r', pronounce: 'enter', known: 'e', flip: ' ', dictationPronounce: 'tab',
    }
    expect(normalizeStudyShortcuts(legacy)).toEqual({ ...legacy, mastered: 'f' })
  })
})
