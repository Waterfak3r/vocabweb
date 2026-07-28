import { describe, expect, it } from 'vitest'
import { isValidWordQuery, normalizeWord, wordbookId } from './normalize'

describe('word normalization', () => {
  it('trims, collapses whitespace, and lowercases', () => {
    expect(normalizeWord('  Well   KNOWN  ')).toBe('well known')
    expect(wordbookId(' Resilient ')).toBe('resilient')
  })

  it('accepts supported words and phrases while rejecting non-letters', () => {
    expect(isValidWordQuery('well-known')).toBe(true)
    expect(isValidWordQuery("don't")).toBe(true)
    expect(isValidWordQuery('rock’n’roll')).toBe(true)
    expect(isValidWordQuery('hello world')).toBe(true)
    expect(isValidWordQuery('word2')).toBe(false)
    expect(isValidWordQuery('')).toBe(false)
  })
})
