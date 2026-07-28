import { describe, expect, it } from 'vitest'
import { characterMask, spellingCharacters } from './DictationPrompt'

describe('spellingCharacters', () => {
  it('marks only the letters that differ at the same position', () => {
    expect(spellingCharacters('recieve', 'receive')).toEqual([
      { character: 'r', incorrect: false },
      { character: 'e', incorrect: false },
      { character: 'c', incorrect: false },
      { character: 'i', incorrect: true },
      { character: 'e', incorrect: true },
      { character: 'v', incorrect: false },
      { character: 'e', incorrect: false },
    ])
  })

  it('marks characters typed beyond the expected word', () => {
    expect(spellingCharacters('wordx', 'word').at(-1)).toEqual({ character: 'x', incorrect: true })
  })
})

describe('characterMask', () => {
  it('hides letters while preserving apostrophes and hyphens', () => {
    expect(characterMask("mother-in-law")).toBe('□□□□□□-□□-□□□')
    expect(characterMask("don't")).toBe("□□□'□")
  })
})
