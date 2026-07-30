import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_STUDY_PREFERENCES } from './studyPreferences'
import { WorkspaceApi } from './workspaceApi'

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function draft(status: 'processing' | 'pending') {
  return {
    id: 'draft-1',
    title: '导入测试',
    description: '',
    batchIndex: 1,
    totalBatches: 1,
    status,
    entries: [{ id: 'entry-1', line: 1, word: 'resilient', status: status === 'processing' ? 'processing' : 'ready' }],
  }
}

describe('WorkspaceApi import drafts', () => {
  it('creates quickly, then starts a resumable background processing job', async () => {
    const fetch = vi.fn<FetchLike>()
      .mockResolvedValueOnce(new Response(JSON.stringify(draft('processing'))))
      .mockResolvedValueOnce(new Response(JSON.stringify(draft('processing'))))
    const api = new WorkspaceApi('https://api.example.test/', { fetch, clientId: () => 'learner' })

    await expect(api.createImportDraft({ title: '导入测试', targetWordbookId: 'my-existing', lines: [{ line: 1, word: 'resilient' }] })).resolves.toMatchObject({ status: 'processing' })
    await expect(api.processImportDraft('draft-1')).resolves.toMatchObject({
      status: 'processing',
      entries: [{ status: 'processing' }],
    })

    expect(fetch.mock.calls.map(([url, init]) => [url.toString(), init?.method])).toEqual([
      ['https://api.example.test/api/my/import-drafts', 'POST'],
      ['https://api.example.test/api/my/import-drafts/draft-1/process', 'POST'],
    ])
    expect(fetch.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({
      title: '导入测试',
      targetWordbookId: 'my-existing',
      lines: [{ line: 1, word: 'resilient' }],
    }))
  })

  it('sends the explicit whole-wordbook overwrite mode', async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(new Response(JSON.stringify({
      id: 'my-existing',
      title: '导入测试',
      description: '',
      createdAt: '2026-07-28T00:00:00.000Z',
      updatedAt: '2026-07-28T00:01:00.000Z',
      wordCount: 2,
      progress: { mastered: 0, learning: 0, review: 0, unstudied: 2, percent: 0, levels: { l0: 2, l1: 0, l2: 0, l3: 0, l4: 0 } },
    })))
    const api = new WorkspaceApi('https://api.example.test/', { fetch, clientId: () => 'learner' })

    await api.commitImportDraft('draft-1', {}, 'overwrite')
    expect(fetch).toHaveBeenCalledWith(
      new URL('https://api.example.test/api/my/import-drafts/draft-1/commit'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ mode: 'overwrite', resolutions: {} }),
      }),
    )
  })
})

function catalog(overrides: Record<string, unknown> = {}) {
  return {
    id: 'catalog-1',
    title: '社区词本',
    description: '测试',
    author: '墨客',
    exams: ['IELTS'],
    goals: ['阅读'],
    rating: 4.8,
    uses: 12,
    createdAt: '2026-07-27T00:00:00.000Z',
    shareCode: 'INVITE88',
    wordCount: 20,
    favoriteCount: 3,
    favorited: true,
    added: false,
    uploaded: true,
    visibility: 'unlisted',
    ...overrides,
  }
}

describe('WorkspaceApi marketplace owner feeds', () => {
  it('parses catalog details with public words and live counters', async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(new Response(JSON.stringify(catalog({
      words: [{ word: 'resilient', phonetic: '/rɪˈzɪliənt/', source: 'user', meanings: [{ pos: 'adjective', definition: 'Able to recover.' }] }],
    }))))
    const api = new WorkspaceApi('https://api.example.test/', { fetch, clientId: () => 'learner' })

    await expect(api.getCatalog('catalog-1')).resolves.toMatchObject({
      favoriteCount: 3,
      words: [{ word: 'resilient' }],
    })
  })

  it('keeps the owner-only source wordbook id needed for an exact snapshot update', async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(
      new Response(JSON.stringify([catalog({ sourceWordbookId: 'my-source-2' })])),
    )
    const api = new WorkspaceApi('https://api.example.test/', { fetch, clientId: () => 'learner' })

    await expect(api.listUploads()).resolves.toEqual([
      expect.objectContaining({
        id: 'catalog-1',
        visibility: 'unlisted',
        sourceWordbookId: 'my-source-2',
      }),
    ])
    expect(fetch).toHaveBeenCalledWith(
      new URL('https://api.example.test/api/catalog/uploads/mine'),
      expect.objectContaining({
        credentials: 'include',
        headers: expect.objectContaining({ 'X-Vocab-Client-Id': 'learner' }),
      }),
    )
  })

  it('loads favorites from the dedicated feed and rejects malformed owner ids', async () => {
    const fetch = vi.fn<FetchLike>()
      .mockResolvedValueOnce(new Response(JSON.stringify([catalog({ uploaded: false })])))
      .mockResolvedValueOnce(new Response(JSON.stringify([catalog({ sourceWordbookId: 42 })])))
    const api = new WorkspaceApi('https://api.example.test/', { fetch, clientId: () => 'learner' })

    await expect(api.listFavorites()).resolves.toHaveLength(1)
    await expect(api.listUploads()).rejects.toThrow('uploads response is invalid')
    expect(fetch.mock.calls.map(([url]) => url.toString())).toEqual([
      'https://api.example.test/api/catalog/favorites',
      'https://api.example.test/api/catalog/uploads/mine',
    ])
  })
})

describe('WorkspaceApi batch word actions', () => {
  it('posts selected ids and preserves partial failures', async () => {
    const payload = {
      action: 'refresh-meanings',
      succeededIds: ['word-1'],
      failed: [{ wordId: 'word-2', code: 'DICTIONARY_UNAVAILABLE' }],
    }
    const fetch = vi.fn<FetchLike>().mockResolvedValue(new Response(JSON.stringify(payload)))
    const api = new WorkspaceApi('https://api.example.test/', { fetch, clientId: () => 'learner' })

    await expect(api.batchWords('my-book', 'refresh-meanings', ['word-1', 'word-2'])).resolves.toEqual(payload)
    expect(fetch).toHaveBeenCalledWith(
      new URL('https://api.example.test/api/my/wordbooks/my-book/words/batch'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ action: 'refresh-meanings', wordIds: ['word-1', 'word-2'] }),
      }),
    )
  })
})

describe('WorkspaceApi adaptive review schedule', () => {
  it('preserves interval and due metadata and rejects malformed schedules', async () => {
    const word = {
      id: 'word-1',
      word: 'resilient',
      phonetic: '/rɪˈzɪliənt/',
      addedAt: '2026-01-01T09:00:00.000Z',
      source: 'user',
      meanings: [],
      status: 'review',
      level: 2,
      recognitionStreak: 0,
      reviewIntervalDays: 7,
      nextReviewAt: '2026-01-12T09:00:00.000Z',
      lastStudiedAt: '2026-01-05T09:00:00.000Z',
    }
    const fetch = vi.fn<FetchLike>()
      .mockResolvedValueOnce(new Response(JSON.stringify([word])))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ ...word, reviewIntervalDays: -1 }])))
    const api = new WorkspaceApi('https://api.example.test/', { fetch, clientId: () => 'learner' })

    await expect(api.listWords('my-book')).resolves.toEqual([
      expect.objectContaining({
        level: 2,
        reviewIntervalDays: 7,
        nextReviewAt: '2026-01-12T09:00:00.000Z',
      }),
    ])
    await expect(api.listWords('my-book')).rejects.toThrow('word list response is invalid')
  })

  it('sends and parses a per-wordbook review plan', async () => {
    const reviewSchedule = {
      learningDays: 2,
      familiarDays: 5,
      masteredDays: 10,
      expertDays: 30,
      lapseDays: 2,
      maxDays: 45,
    }
    const fetch = vi.fn<FetchLike>().mockResolvedValue(new Response(JSON.stringify({
      id: 'my-book',
      title: '自定义方案',
      description: '',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      wordCount: 0,
      progress: { mastered: 0, learning: 0, review: 0, unstudied: 0, percent: 0, levels: { l0: 0, l1: 0, l2: 0, l3: 0, l4: 0 } },
      reviewSchedule,
    })))
    const api = new WorkspaceApi('https://api.example.test/', { fetch, clientId: () => 'learner' })

    await expect(api.updateMyWordbook('my-book', { reviewSchedule })).resolves.toEqual(
      expect.objectContaining({ id: 'my-book', reviewSchedule }),
    )
    expect(fetch).toHaveBeenCalledWith(
      new URL('https://api.example.test/api/my/wordbooks/my-book'),
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ reviewSchedule }),
      }),
    )
  })
})

describe('WorkspaceApi synchronized study settings', () => {
  it('loads account-wide settings and persists per-wordbook preferences', async () => {
    const shortcuts = {
      unknown: 'a',
      pronounce: 'enter',
      known: 'd',
      flip: ' ',
      dictationPronounce: 'tab',
    }
    const preferences = {
      ...structuredClone(DEFAULT_STUDY_PREFERENCES),
      plan: { newWords: 32, dictation: 12 },
    }
    const synced = {
      shortcuts,
      pronunciation: { accent: 'us' },
      updatedAt: '2026-07-31T01:00:00.000Z',
    }
    const wordbook = {
      id: 'my-book',
      title: '多端设置',
      description: '',
      createdAt: '2026-07-30T00:00:00.000Z',
      updatedAt: '2026-07-31T01:00:00.000Z',
      wordCount: 0,
      progress: { mastered: 0, learning: 0, review: 0, unstudied: 0, percent: 0, levels: { l0: 0, l1: 0, l2: 0, l3: 0, l4: 0 } },
      studyPreferences: preferences,
    }
    const fetch = vi.fn<FetchLike>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ settings: synced })))
      .mockResolvedValueOnce(new Response(JSON.stringify(synced)))
      .mockResolvedValueOnce(new Response(JSON.stringify(wordbook)))
    const api = new WorkspaceApi('https://api.example.test/', { fetch, clientId: () => 'learner' })

    await expect(api.getStudySettings()).resolves.toEqual({ settings: synced })
    await expect(api.updateStudySettings({ pronunciation: { accent: 'us' } })).resolves.toEqual(synced)
    await expect(api.updateMyWordbook('my-book', { studyPreferences: preferences })).resolves.toEqual(
      expect.objectContaining({ id: 'my-book', studyPreferences: preferences }),
    )

    expect(fetch.mock.calls.map(([url, init]) => [url.toString(), init?.method, init?.body])).toEqual([
      ['https://api.example.test/api/my/study-settings', undefined, undefined],
      ['https://api.example.test/api/my/study-settings', 'PATCH', JSON.stringify({ pronunciation: { accent: 'us' } })],
      ['https://api.example.test/api/my/wordbooks/my-book', 'PATCH', JSON.stringify({ studyPreferences: preferences })],
    ])
  })

  it('distinguishes an unsynced server record and rejects malformed cloud settings', async () => {
    const fetch = vi.fn<FetchLike>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ settings: null })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        settings: {
          shortcuts: { unknown: 'q', pronounce: 'q', known: 'e', flip: ' ', dictationPronounce: 'tab' },
          pronunciation: { accent: 'gb' },
          updatedAt: '2026-07-31T01:00:00.000Z',
        },
      })))
    const api = new WorkspaceApi('https://api.example.test/', { fetch, clientId: () => 'learner' })

    await expect(api.getStudySettings()).resolves.toEqual({ settings: null })
    await expect(api.getStudySettings()).rejects.toThrow('Backend response is invalid')
  })
})
