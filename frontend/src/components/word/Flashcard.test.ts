import { describe, expect, it } from 'vitest'
import type { WordbookItem } from '../../domain/types'
import { preferredMeanings } from './Flashcard'

const item: WordbookItem = {
  id: 'clear',
  word: 'clear',
  phonetic: '/klɪə/',
  source: 'user',
  addedAt: '2026-01-01T00:00:00.000Z',
  meanings: [
    { pos: 'adjective', definition: '清楚的；明显的' },
    { pos: 'adjective', definition: 'Easy to understand.' },
  ],
}

describe('preferredMeanings', () => {
  it('selects Chinese or English meanings and falls back safely', () => {
    expect(preferredMeanings(item, 'zh')[0]?.definition).toContain('清楚')
    expect(preferredMeanings(item, 'en')[0]?.definition).toBe('Easy to understand.')
    expect(preferredMeanings({ ...item, meanings: item.meanings.slice(1) }, 'zh')).toHaveLength(1)
  })

  it('prefers the dedicated learner Chinese meaning without replacing English glosses', () => {
    const customized = { ...item, zhMeaning: '用户自己的中文解释', zhMeaningSource: 'user' as const }
    expect(preferredMeanings(customized, 'zh')).toEqual([{ pos: '中文', definition: '用户自己的中文解释' }])
    expect(preferredMeanings(customized, 'en')[0]?.definition).toBe('Easy to understand.')
  })

  it('falls back from missing English to a dedicated Chinese meaning', () => {
    const chineseOnly = {
      ...item,
      meanings: [{ pos: 'verb', definition: '   ' }],
      zhMeaning: '  行动；起作用  ',
    }
    expect(preferredMeanings(chineseOnly, 'en')).toEqual([{ pos: '中文', definition: '行动；起作用' }])
  })

  it('falls back from missing Chinese to a valid English meaning and ignores blank rows', () => {
    const englishOnly = {
      ...item,
      zhMeaning: '   ',
      meanings: [
        { pos: 'noun', definition: '' },
        { pos: ' verb ', definition: '  To take action.  ' },
      ],
    }
    expect(preferredMeanings(englishOnly, 'zh')).toEqual([{ pos: 'verb', definition: 'To take action.' }])
  })

  it('returns no definition only when neither language has usable content', () => {
    expect(preferredMeanings({ ...item, meanings: [], zhMeaning: '   ' }, 'zh')).toEqual([])
  })
})
