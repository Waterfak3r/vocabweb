import { describe, expect, it } from 'vitest'
import { advanceRecognition } from './useFlashcardSession'

describe('new-word recognition streak', () => {
  it('requires three consecutive known verdicts and resets on unknown', () => {
    expect(advanceRecognition(0, 'know')).toEqual({ streak: 1, completed: false })
    expect(advanceRecognition(1, 'know')).toEqual({ streak: 2, completed: false })
    expect(advanceRecognition(2, 'unknown')).toEqual({ streak: 0, completed: false })
    expect(advanceRecognition(2, 'know')).toEqual({ streak: 3, completed: true })
  })

  it('keeps review mode on its one-pass behavior', () => {
    expect(advanceRecognition(0, 'know', 1)).toEqual({ streak: 1, completed: true })
  })
})
