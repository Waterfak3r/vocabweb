import { describe, expect, it } from 'vitest'
import type { StudyDashboard } from './workspaceApi'
import {
  clearAllWordbookStudyCaches,
  clearWordbookStudyMemoryCache,
  invalidateWordbookStudyCache,
  readCachedWordbookDashboard,
  readCachedWordbookWords,
  WORDBOOK_DASHBOARD_CACHE_TTL_MS,
  WORDBOOK_WORDS_CACHE_TTL_MS,
  writeCachedWordbookDashboard,
  writeCachedWordbookWords,
} from './wordbookStudyCache'

class MemoryStorage {
  private readonly values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}

function dashboard(wordbookId: string, streakDays = 3): StudyDashboard {
  return {
    wordbook: {
      id: wordbookId,
      title: `词本 ${wordbookId}`,
      description: '',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-02T01:00:00.000Z',
      wordCount: 1,
      progress: {
        mastered: 0,
        learning: 1,
        review: 0,
        unstudied: 0,
        percent: 25,
        levels: { l0: 0, l1: 1, l2: 0, l3: 0, l4: 0 },
      },
      reviewSchedule: { learningDays: 1, familiarDays: 3, masteredDays: 7, expertDays: 21, lapseDays: 1, maxDays: 60 },
    },
    todayPlan: {
      new: { target: 1, completed: 1 },
      review: { target: 0, completed: 0 },
      dictation: { target: 0, completed: 0 },
    },
    recentActivity: [{
      id: 'event-1',
      kind: 'new',
      wordbookId,
      word: 'resilient',
      occurredAt: '2026-08-02T01:00:00.000Z',
      verdict: 'know',
      levelAfter: 1,
    }],
    calendar: [{ date: '2026-08-02', count: 1, active: true }],
    week: { newCount: 1, reviewCount: 0, dictationCount: 0, total: 1 },
    streakDays,
    updatedAt: '2026-08-02T01:00:00.000Z',
  }
}

const WORD = {
  id: 'word-1',
  word: 'resilient',
  phonetic: '',
  meanings: [],
  source: 'user' as const,
  addedAt: '2026-08-01T00:00:00.000Z',
  level: 1 as const,
}

describe('wordbook study cache', () => {
  it('restores the complete dashboard snapshot from browser storage and isolates clients', () => {
    const storage = new MemoryStorage()
    const now = new Date(2026, 7, 2, 10).getTime()
    const snapshot = dashboard('book-1', 6)

    writeCachedWordbookDashboard('client-a', 'book-1', snapshot, now, storage)
    clearWordbookStudyMemoryCache()

    expect(readCachedWordbookDashboard('client-a', 'book-1', now + 1_000, storage)).toEqual(snapshot)
    expect(readCachedWordbookDashboard('client-b', 'book-1', now + 1_000, storage)).toBeNull()
    expect(readCachedWordbookDashboard('client-a', 'book-1', now + WORDBOOK_DASHBOARD_CACHE_TTL_MS, storage)).toBeNull()
  })

  it('expires dashboard cards at the local day boundary', () => {
    const storage = new MemoryStorage()
    const beforeMidnight = new Date(2026, 7, 2, 23, 59).getTime()
    writeCachedWordbookDashboard('client-a', 'book-1', dashboard('book-1'), beforeMidnight, storage)
    clearWordbookStudyMemoryCache()

    expect(readCachedWordbookDashboard('client-a', 'book-1', new Date(2026, 7, 3, 0, 1).getTime(), storage)).toBeNull()
  })

  it('keeps large word lists in bounded-lifetime browser memory for fast switching', () => {
    const now = Date.now()
    writeCachedWordbookWords('client-a', 'book-1', [WORD], now)

    expect(readCachedWordbookWords('client-a', 'book-1', now + 1)).toEqual([WORD])
    expect(readCachedWordbookWords('client-b', 'book-1', now + 1)).toBeNull()
    expect(readCachedWordbookWords('client-a', 'book-1', now + WORDBOOK_WORDS_CACHE_TTL_MS)).toBeNull()
  })

  it('invalidates only the mutated wordbook and supports a full privacy clear', () => {
    const storage = new MemoryStorage()
    const now = Date.now()
    writeCachedWordbookDashboard('client-a', 'book-1', dashboard('book-1'), now, storage)
    writeCachedWordbookDashboard('client-a', 'book-2', dashboard('book-2'), now, storage)
    writeCachedWordbookWords('client-a', 'book-1', [WORD], now)

    invalidateWordbookStudyCache('client-a', 'book-1', storage)
    clearWordbookStudyMemoryCache()
    expect(readCachedWordbookDashboard('client-a', 'book-1', now + 1, storage)).toBeNull()
    expect(readCachedWordbookDashboard('client-a', 'book-2', now + 1, storage)).not.toBeNull()
    expect(readCachedWordbookWords('client-a', 'book-1', now + 1)).toBeNull()

    clearAllWordbookStudyCaches(storage)
    expect(readCachedWordbookDashboard('client-a', 'book-2', now + 1, storage)).toBeNull()
  })

  it('can refresh dashboard cards without discarding a large loaded word list', () => {
    const storage = new MemoryStorage()
    const now = Date.now()
    writeCachedWordbookDashboard('client-a', 'book-1', dashboard('book-1'), now, storage)
    writeCachedWordbookWords('client-a', 'book-1', [WORD], now)

    invalidateWordbookStudyCache('client-a', 'book-1', storage, { dashboard: true, words: false })

    expect(readCachedWordbookDashboard('client-a', 'book-1', now + 1, storage)).toBeNull()
    expect(readCachedWordbookWords('client-a', 'book-1', now + 1)).toEqual([WORD])
  })
})
