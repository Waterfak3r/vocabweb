import { describe, expect, it } from 'vitest'
import type { WordbookItem } from '../domain/types'
import { parseWordbookText } from './wordbookImport'
import { wordbookCsvFilename, wordbookToCsv } from './wordbookExport'

const entry: WordbookItem = {
  id: 'word-alpha',
  word: 'alpha',
  phonetic: '/ˈælfə/',
  zhMeaning: '阿尔法，首项',
  source: 'user',
  addedAt: '2026-07-31T00:00:00.000Z',
  meanings: [
    { pos: 'noun', definition: 'The first item, in a sequence.', example: 'Alpha comes first.' },
    { pos: 'adjective', definition: 'Dominant "in rank".' },
  ],
}

describe('wordbook CSV export', () => {
  it('round-trips every meaning through continuation rows', () => {
    const csv = wordbookToCsv([entry])
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('"单词","音标","词性","英文释义","中文释义","例句"')

    const parsed = parseWordbookText(csv)
    expect(parsed.acceptedCount).toBe(1)
    expect(parsed.entries).toEqual([{
      line: 2,
      raw: expect.any(String),
      word: 'alpha',
      phonetic: '/ˈælfə/',
      zhMeaning: '阿尔法，首项',
      meanings: entry.meanings,
      status: 'ready',
    }])
  })

  it('uses a filesystem-safe Chinese filename', () => {
    expect(wordbookCsvFilename(' 商务英语:进阶/版. ')).toBe('商务英语-进阶-版-单词表.csv')
    expect(wordbookCsvFilename('...')).toBe('单词本-单词表.csv')
  })
})
