import { describe, expect, it } from 'vitest'
import {
  readPronunciationPreferences,
  writePronunciationPreferences,
} from './pronunciationPreferences'

function memoryStorage(initial: string | null = null) {
  let value = initial
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => { value = next },
  }
}

describe('pronunciation preferences', () => {
  it('defaults to British pronunciation', () => {
    expect(readPronunciationPreferences(memoryStorage())).toEqual({ accent: 'gb' })
  })

  it('persists American pronunciation and normalizes invalid data', () => {
    const storage = memoryStorage()
    expect(writePronunciationPreferences({ accent: 'us' }, storage)).toEqual({ accent: 'us' })
    expect(readPronunciationPreferences(storage)).toEqual({ accent: 'us' })
    expect(readPronunciationPreferences(memoryStorage('{"accent":"invalid"}'))).toEqual({ accent: 'gb' })
  })
})
