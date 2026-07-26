import { describe, expect, it } from 'vitest'
import { deriveLocalStudySummary, mostRecentWordbook, summarizeMyWordbooks } from './studyApi'
import type { MyWordbook } from './workspaceApi'
import type { WordbookItem } from '../domain/types'

function book(overrides: Partial<MyWordbook> & { id: string; updatedAt: string }): MyWordbook {
  return {
    id: overrides.id,
    title: overrides.title ?? overrides.id,
    description: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt,
    wordCount: overrides.wordCount ?? 0,
    progress: overrides.progress ?? {
      mastered: 0, learning: 0, review: 0, unstudied: 0, percent: 0,
      levels: { l0: 0, l1: 0, l2: 0, l3: 0, l4: 0 },
    },
  }
}

function item(id: string): WordbookItem {
  return { id, word: id, phonetic: '', meanings: [], source: 'user', addedAt: '2026-07-26T00:00:00.000Z' }
}

describe('mostRecentWordbook', () => {
  it('returns the wordbook with the greatest updatedAt', () => {
    const recent = mostRecentWordbook([
      book({ id: 'a', updatedAt: '2026-07-01T00:00:00.000Z' }),
      book({ id: 'b', updatedAt: '2026-07-26T00:00:00.000Z' }),
      book({ id: 'c', updatedAt: '2026-07-10T00:00:00.000Z' }),
    ])
    expect(recent?.id).toBe('b')
  })

  it('returns null for an empty list', () => {
    expect(mostRecentWordbook([])).toBeNull()
  })
})

describe('summarizeMyWordbooks', () => {
  it('reports the recent book with lifecycle-derived numbers', () => {
    const summary = summarizeMyWordbooks([
      book({ id: 'old', updatedAt: '2026-07-01T00:00:00.000Z', wordCount: 10 }),
      book({
        id: 'recent',
        title: '雅思核心',
        updatedAt: '2026-07-26T00:00:00.000Z',
        wordCount: 40,
        progress: {
          mastered: 12, learning: 8, review: 5, unstudied: 15, percent: 46,
          levels: { l0: 15, l1: 8, l2: 5, l3: 9, l4: 3 },
        },
      }),
    ])

    // learning + review are both review-eligible under the new lifecycle.
    expect(summary.reviewDue).toBe(13)
    // studied words = total - never-studied.
    expect(summary.dictationDue).toBe(25)
    expect(summary.wordbookCount).toBe(2)
    // wordbookTotal sums every book's words.
    expect(summary.wordbookTotal).toBe(50)
    expect(summary.recent).toEqual({ title: '雅思核心', reviewDue: 13, mastered: 12, unstudied: 15 })
    expect(summary.updatedAt).toBe('2026-07-26T00:00:00.000Z')
  })

  it('degrades to zeros with no recent book for an empty list', () => {
    const summary = summarizeMyWordbooks([])
    expect(summary.recent).toBeNull()
    expect(summary.wordbookCount).toBe(0)
    expect(summary.reviewDue).toBe(0)
    expect(summary.dictationDue).toBe(0)
  })
})

describe('deriveLocalStudySummary', () => {
  it('proves only local counts and never claims a remote book', () => {
    const summary = deriveLocalStudySummary([item('resilient'), item('ubiquitous')])
    expect(summary.wordbookTotal).toBe(2)
    expect(summary.reviewDue).toBe(2)
    expect(summary.dictationDue).toBe(2)
    expect(summary.wordbookCount).toBe(0)
    expect(summary.recent).toBeNull()
  })
})
