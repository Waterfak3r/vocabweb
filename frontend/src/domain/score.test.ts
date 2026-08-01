import { describe, expect, it, vi } from 'vitest'
import type { DictationAnswer, WordbookItem } from './types'
import { countCorrect, gradeAnswer, normalizeDictationText, shuffled, wrongItems } from './score'

const ITEMS: WordbookItem[] = [
  {
    id: 'resilient',
    word: 'resilient',
    phonetic: '',
    meanings: [{ pos: 'adjective', definition: 'Able to recover quickly.' }],
    source: 'local-ielts',
    addedAt: '2026-07-23T00:00:00.000Z',
  },
  {
    id: 'mitigate',
    word: 'mitigate',
    phonetic: '',
    meanings: [{ pos: 'verb', definition: 'Make less severe.' }],
    source: 'local-ielts',
    addedAt: '2026-07-23T00:01:00.000Z',
  },
]

describe('dictation scoring', () => {
  it('grades normalized exact matches', () => {
    expect(gradeAnswer('  RESILIENT ', ITEMS[0])).toBe('correct')
    expect(gradeAnswer('resilience', ITEMS[0])).toBe('incorrect')
  })

  it('does not require punctuation that cannot be heard', () => {
    const phrase = (word: string): WordbookItem => ({ ...ITEMS[0], id: word, word })
    expect(gradeAnswer('agree with sb', phrase('agree with sb.'))).toBe('correct')
    expect(gradeAnswer('connect with', phrase('connect...with...'))).toBe('correct')
    expect(gradeAnswer('provide sb with', phrase('provide sb. with ...'))).toBe('correct')
    expect(gradeAnswer('well known', phrase('well-known'))).toBe('correct')
    expect(gradeAnswer('well-known', phrase('well known'))).toBe('correct')
    expect(gradeAnswer('initial public offering', phrase('initial public offering (ipo)'))).toBe('correct')
    expect(gradeAnswer('initial public offering (IPO)', phrase('initial public offering (ipo)'))).toBe('correct')
    expect(gradeAnswer('research and development', phrase('research and development (r&d)'))).toBe('correct')
    expect(normalizeDictationText('  CONNECT...WITH... ')).toBe('connect with')
    expect(gradeAnswer('connect to', phrase('connect...with...'))).toBe('incorrect')
  })

  it('counts correct answers and returns the wrong deck in deck order', () => {
    const answers: DictationAnswer[] = [
      { itemId: 'mitigate', word: 'mitigate', given: 'mitgate', grade: 'incorrect' },
      { itemId: 'resilient', word: 'resilient', given: 'resilient', grade: 'correct' },
      { itemId: 'resilient', word: 'resilient', given: '', grade: 'skipped' },
    ]

    expect(countCorrect(answers)).toBe(1)
    expect(wrongItems(answers, ITEMS)).toEqual([ITEMS[1]])
  })

  it('shuffles a copy without mutating the source', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const source = [...ITEMS]

    expect(shuffled(source)).toEqual([ITEMS[1], ITEMS[0]])
    expect(source).toEqual(ITEMS)
    vi.restoreAllMocks()
  })
})
