import { describe, expect, it } from 'vitest'
import { filterManagedWords, parseEditableMeanings, type EditableWordbookItem } from './WordManagerDialog'

const ENTRIES: EditableWordbookItem[] = [
  {
    id: 'resilient',
    word: 'resilient',
    phonetic: '',
    meanings: [{ pos: 'adjective', definition: 'Able to recover quickly.' }],
    zhMeaning: '有韧性的',
    source: 'user',
    addedAt: '2026-01-01T00:00:00.000Z',
    level: 0,
  },
  {
    id: 'mitigate',
    word: 'mitigate',
    phonetic: '',
    meanings: [{ pos: 'verb', definition: 'Make less severe.' }],
    source: 'user',
    addedAt: '2026-01-01T00:00:00.000Z',
    level: 2,
  },
]

describe('parseEditableMeanings', () => {
  it('keeps definitions and optional examples line by line', () => {
    expect(parseEditableMeanings('noun | a test | This is a test.\nverb | to examine')).toEqual([
      { pos: 'noun', definition: 'a test', example: 'This is a test.' },
      { pos: 'verb', definition: 'to examine' },
    ])
  })

  it('keeps a standalone part of speech when the definition is intentionally blank', () => {
    expect(parseEditableMeanings('\nverb |\n | usable definition')).toEqual([
      { pos: 'verb', definition: '' },
      { pos: 'unknown', definition: 'usable definition' },
    ])
  })
})

describe('filterManagedWords', () => {
  it('filters the browser by proficiency level', () => {
    expect(filterManagedWords(ENTRIES, '', 0)).toEqual([ENTRIES[0]])
    expect(filterManagedWords(ENTRIES, '', 2)).toEqual([ENTRIES[1]])
    expect(filterManagedWords(ENTRIES, '', 4)).toEqual([])
  })

  it('combines the proficiency filter with text search', () => {
    expect(filterManagedWords(ENTRIES, 'recover', 0)).toEqual([ENTRIES[0]])
    expect(filterManagedWords(ENTRIES, 'recover', 2)).toEqual([])
    expect(filterManagedWords(ENTRIES, '有韧性', 'all')).toEqual([ENTRIES[0]])
  })
})
