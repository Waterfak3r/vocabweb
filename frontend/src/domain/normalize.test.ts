import { describe, expect, it } from 'vitest'
import { isValidWordQuery, normalizeWord, wordbookId } from './normalize'

describe('word normalization', () => {
  it('trims, collapses whitespace, and lowercases', () => {
    expect(normalizeWord('  Well   KNOWN  ')).toBe('well known')
    expect(wordbookId(' Resilient ')).toBe('resilient')
  })

  it('accepts supported lemmas and rejects phrases or non-letters', () => {
    expect(isValidWordQuery('well-known')).toBe(true)
    expect(isValidWordQuery("don't")).toBe(true)
    expect(isValidWordQuery('rock’n’roll')).toBe(true)
    expect(isValidWordQuery('hello world')).toBe(false)
    expect(isValidWordQuery('word2')).toBe(false)
    expect(isValidWordQuery('')).toBe(false)
  })
})
