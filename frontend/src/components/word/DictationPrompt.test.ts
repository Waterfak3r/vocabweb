import { describe, expect, it } from 'vitest'
import { spellingCharacters } from './DictationPrompt'

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
})
