import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STUDY_PREFERENCES,
  normalizeStudyPreferences,
  readStudyPreferences,
  writeStudyPreferences,
} from './studyPreferences'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  }
}

describe('study preferences', () => {
  it('uses safe defaults for missing or malformed values', () => {
    expect(normalizeStudyPreferences(null)).toEqual(DEFAULT_STUDY_PREFERENCES)
    expect(normalizeStudyPreferences({
      plan: { newWords: -3, dictation: 2.6 },
      modes: { new: { meaningPreference: 'unknown', showExamples: false } },
    })).toMatchObject({
      plan: { newWords: 0, dictation: 3 },
      modes: { new: { meaningPreference: 'zh', showExamples: false, showPhonetic: true } },
    })
    expect(normalizeStudyPreferences({ modes: { dictation: {} } }).modes.dictation).toMatchObject({
      autoPlayAudio: true,
      showPhonetic: false,
      showMeaning: false,
      showCharacterMask: true,
    })
  })

  it('keeps settings isolated per wordbook', () => {
    const storage = memoryStorage()
    writeStudyPreferences('first', {
      ...DEFAULT_STUDY_PREFERENCES,
      plan: { newWords: 8, dictation: 6 },
    }, storage)
    expect(readStudyPreferences('first', storage).plan).toEqual({ newWords: 8, dictation: 6 })
    expect(readStudyPreferences('second', storage)).toEqual(DEFAULT_STUDY_PREFERENCES)
  })
})
