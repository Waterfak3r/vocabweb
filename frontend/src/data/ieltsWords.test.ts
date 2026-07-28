import { describe, expect, it } from 'vitest'
import { IELTS_WORDS, localDayNumber, wordOfTheDay } from './ieltsWords'

function localDateFromDay(day: number) {
  const utc = new Date(day * 86_400_000)
  return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate(), 12)
}

describe('word of the day', () => {
  it('is stable during one local calendar date', () => {
    const morning = new Date(2026, 6, 28, 0, 1)
    const evening = new Date(2026, 6, 28, 23, 59)
    expect(wordOfTheDay(morning)).toBe(wordOfTheDay(evening))
  })

  it('uses every headword exactly once per complete cycle', () => {
    const start = localDayNumber(new Date(2026, 0, 1))
    const cycleStart = start - (start % IELTS_WORDS.length)
    const words = Array.from(
      { length: IELTS_WORDS.length },
      (_, offset) => wordOfTheDay(localDateFromDay(cycleStart + offset)),
    )
    expect(new Set(words).size).toBe(IELTS_WORDS.length)
    expect(new Set(words)).toEqual(new Set(IELTS_WORDS.map((entry) => entry.word)))
  })

  it('avoids repeating the same headword at a cycle boundary', () => {
    const length = IELTS_WORDS.length
    for (let cycle = 1; cycle <= 20; cycle += 1) {
      expect(wordOfTheDay(localDateFromDay(cycle * length - 1)))
        .not.toBe(wordOfTheDay(localDateFromDay(cycle * length)))
    }
  })
})
