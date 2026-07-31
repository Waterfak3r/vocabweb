import { describe, expect, it } from 'vitest'
import { advanceDictationStreak, skippedDictationAnswer } from './useDictationSession'

describe('dictation consecutive pass rule', () => {
  it('passes only on the third consecutive correct attempt', () => {
    expect(advanceDictationStreak(0, true)).toEqual({ streak: 1, passed: false })
    expect(advanceDictationStreak(1, true)).toEqual({ streak: 2, passed: false })
    expect(advanceDictationStreak(2, true)).toEqual({ streak: 3, passed: true })
  })

  it('resets immediately after an incorrect attempt', () => {
    expect(advanceDictationStreak(2, false)).toEqual({ streak: 0, passed: false })
  })

  it('records a skip as an incorrect unanswered attempt', () => {
    expect(skippedDictationAnswer({ id: 'word-1', word: 'resilient' })).toEqual({
      itemId: 'word-1',
      word: 'resilient',
      given: '',
      grade: 'incorrect',
      skipped: true,
    })
  })
})
