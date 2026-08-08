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

    const lines = [{
      line: 1,
      word: 'resilient',
      phonetic: '/rɪˈzɪliənt/',
      meanings: [{ pos: 'adjective', definition: 'Able to recover.' }],
    }]
    await expect(api.createImportDraft({ title: '导入测试', targetWordbookId: 'my-existing', lines })).resolves.toMatchObject({ status: 'processing' })
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
      lines,
    }))
  })

  it('keeps the transient queued flag from the create response', async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(new Response(JSON.stringify({ ...draft('processing'), queued: true })))
    const api = new WorkspaceApi('https://api.example.test/', { fetch, clientId: () => 'learner' })

    await expect(api.createImportDraft({ title: '导入测试', lines: [{ line: 1, word: 'resilient' }] })).resolves.toMatchObject({ queued: true })
  })

  it('keeps invalid rows without a normalized word in the persisted problem summary', async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(new Response(JSON.stringify({
      ...draft('pending'),
      entries: [{ id: 'entry-invalid', line: 7, status: 'invalid', reason: '英文单词格式无效' }],
    })))
    const api = new WorkspaceApi('https://api.example.test/', { fetch, clientId: () => 'learner' })

    await expect(api.createImportDraft({ title: '导入测试', lines: [{ line: 7, word: '' }] })).resolves.toMatchObject({
      entries: [{ line: 7, word: undefined, status: 'invalid' }],
    })
  })

  it('reads lightweight whole-group status without downloading draft entries', async () => {
    const summary = {
      groupId: 'group-1',
      anchorId: 'draft-1',
      title: '四千词导入',
      status: 'processing',
      batchCount: 8,
      totalBatches: 8,
      completedBatches: 2,
      totalEntries: 4_000,
      completedEntries: 1_000,
      problemCount: 3,
      nextProcessingDraftId: 'draft-3',
      queued: true,
      updatedAt: '2026-08-02T08:00:00.000Z',
    }
    const fetch = vi.fn<FetchLike>().mockResolvedValue(new Response(JSON.stringify([summary])))
    const api = new WorkspaceApi('https://api.example.test/', { fetch, clientId: () => 'learner' })

    await expect(api.listImportDraftTasks()).resolves.toEqual([summary])
    expect(fetch).toHaveBeenCalledWith(
      new URL('https://api.example.test/api/my/import-drafts/status'),
      expect.any(Object),
    )
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

describe('WorkspaceApi account contracts', () => {
  it('parses account metadata and posts password changes with credentials', async () => {
    const account = {
      username: '墨客',
      clientId: 'client-account-0001',
      role: 'user',
      createdAt: '2026-07-31T00:00:00.000Z',
      avatarUrl: null,
      capabilities: [],
    }
    const fetch = vi.fn<FetchLike>()
      .mockResolvedValueOnce(new Response(JSON.stringify(account)))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    const api = new WorkspaceApi('https://api.example.test/', {
      fetch,
      clientId: () => 'client-account-0001',
    })

    await expect(api.me()).resolves.toEqual(account)
    await expect(api.changePassword('password-123', 'new-password-456')).resolves.toBeUndefined()
    expect(fetch.mock.calls.map(([url, init]) => [url.toString(), init?.method, init?.body])).toEqual([
      ['https://api.example.test/api/auth/me', undefined, undefined],
      [
        'https://api.example.test/api/account/password',
        'POST',
        JSON.stringify({ currentPassword: 'password-123', newPassword: 'new-password-456' }),
      ],
    ])
    expect(fetch.mock.calls[1]?.[1]).toEqual(expect.objectContaining({ credentials: 'include' }))
  })

  it('accepts an older account DTO without a join date but rejects a malformed one', async () => {
    const legacy = {
      username: 'Learner',
      clientId: 'client-account-0002',
      role: 'user',
      capabilities: [],
    }
    const fetch = vi.fn<FetchLike>()
      .mockResolvedValueOnce(new Response(JSON.stringify(legacy)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...legacy, createdAt: 42 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...legacy, avatarUrl: 'https://tracker.example/avatar.png' })))
    const api = new WorkspaceApi('https://api.example.test/', {
      fetch,
      clientId: () => 'client-account-0002',
    })

    await expect(api.me()).resolves.toEqual(legacy)
    await expect(api.me()).rejects.toThrow('Backend response is invalid')
    await expect(api.me()).rejects.toThrow('Backend response is invalid')
  })

  it('uploads raw avatar bytes and returns replacements or the explicit no-avatar state', async () => {
    const account = {
      username: 'Learner',
      clientId: 'client-account-0003',
      role: 'user',
      createdAt: '2026-08-08T00:00:00.000Z',
      avatarUrl: '/api/account/avatar/9ef03dd4-0e65-4c45-9dca-80da679dce4c',
      capabilities: [],
    } as const
    const removed = { ...account, avatarUrl: null }
    const fetch = vi.fn<FetchLike>()
      .mockResolvedValueOnce(new Response(JSON.stringify(account)))
      .mockResolvedValueOnce(new Response(JSON.stringify(removed)))
    const api = new WorkspaceApi('https://api.example.test/', {
      fetch,
      clientId: () => account.clientId,
    })
    const image = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' })

    await expect(api.uploadAccountAvatar(image)).resolves.toEqual(account)
    await expect(api.deleteAccountAvatar()).resolves.toEqual(removed)
    expect(fetch).toHaveBeenNthCalledWith(1, new URL('https://api.example.test/api/account/avatar'), expect.objectContaining({
      method: 'PUT',
      body: image,
      credentials: 'include',
      headers: expect.objectContaining({ 'Content-Type': 'image/png' }),
    }))
    expect(fetch).toHaveBeenNthCalledWith(2, new URL('https://api.example.test/api/account/avatar'), expect.objectContaining({
      method: 'DELETE',
      credentials: 'include',
    }))
  })

  it('loads the account study profile and rejects an incomplete activity window', async () => {
    const profile = {
      metrics: { wordbookCount: 2, wordCount: 12, learnedWordCount: 7, currentStreak: 3, longestStreak: 9 },
      activityWindow: { startDate: '2026-05-11', endDate: '2026-08-08', days: 90 },
      activity: Array.from({ length: 90 }, (_, index) => ({ date: new Date(Date.UTC(2026, 4, 11 + index)).toISOString().slice(0, 10), count: index === 89 ? 2 : 0 })),
      recentActivity: [{
        id: 'event-1',
        kind: 'flashcard',
        wordbookId: 'book-1',
        wordbookTitle: '我的词书',
        word: 'resilient',
        occurredAt: '2026-08-07T08:00:00.000Z',
        verdict: 'know',
        levelAfter: 2,
      }],
    }
    const fetch = vi.fn<FetchLike>()
      .mockResolvedValueOnce(new Response(JSON.stringify(profile)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...profile, activity: profile.activity.slice(0, 89) })))
    const api = new WorkspaceApi('https://api.example.test/', { fetch, clientId: () => 'learner' })

    await expect(api.getAccountProfile()).resolves.toEqual(profile)
    await expect(api.getAccountProfile()).rejects.toThrow('Backend response is invalid')
    expect(fetch.mock.calls.map(([url]) => url.toString())).toEqual([
      'https://api.example.test/api/account/profile',
      'https://api.example.test/api/account/profile',
    ])
  })
})

describe('WorkspaceApi collaboration contracts', () => {
  const word = {
    word: 'alpha',
    phonetic: '/alpha/',
    meanings: [{ pos: 'noun', definition: 'first' }],
    source: 'user',
    zhMeaning: '甲',
    zhMeaningSource: 'user',
  }
  const change = { kind: 'update', key: 'alpha', before: word, after: { ...word, zhMeaning: '阿尔法' } }
  const stats = { additions: 0, deletions: 0, updates: 1, changedWords: 1 }
  const contribution = {
    id: 'contribution-1',
    catalogId: 'catalog-1',
    catalogTitle: 'Shared',
    contributor: '墨客',
    baseRevisionId: 'revision-1',
    submittedHeadRevisionId: 'revision-1',
    title: '完善释义',
    description: '',
    status: 'open',
    changes: [change],
    stats,
    createdAt: '2026-07-31T00:00:00.000Z',
    updatedAt: '2026-07-31T00:00:00.000Z',
    canMerge: false,
    canClose: true,
  }

  it('parses a three-way preview and submits its optimistic version fields', async () => {
    const preview = {
      catalogId: 'catalog-1',
      catalogTitle: 'Shared',
      sourceWordbookId: 'my-1',
      baseRevisionId: 'revision-1',
      headRevisionId: 'revision-2',
      expectedSourceUpdatedAt: '2026-07-31T00:01:00.000Z',
      expectedHeadRevisionId: 'revision-2',
      legacyBaseline: false,
      changes: [change],
      stats,
      overlaps: [],
    }
    const fetch = vi.fn<FetchLike>()
      .mockResolvedValueOnce(new Response(JSON.stringify(preview)))
      .mockResolvedValueOnce(new Response(JSON.stringify(contribution), { status: 201 }))
    const api = new WorkspaceApi('https://api.example.test/', { fetch, clientId: () => 'learner' })

    await expect(api.getContributionPreview('my-1')).resolves.toMatchObject({ changes: [{ kind: 'update', key: 'alpha' }] })
    await api.createContribution('catalog-1', {
      title: '完善释义',
      expectedSourceUpdatedAt: preview.expectedSourceUpdatedAt,
      expectedHeadRevisionId: preview.expectedHeadRevisionId,
    })
    expect(fetch.mock.calls[1]?.[0].toString()).toBe('https://api.example.test/api/catalog/wordbooks/catalog-1/contributions')
    expect(fetch.mock.calls[1]?.[1]?.body).toBe(JSON.stringify({
      title: '完善释义',
      expectedSourceUpdatedAt: preview.expectedSourceUpdatedAt,
      expectedHeadRevisionId: preview.expectedHeadRevisionId,
    }))
  })

  it('parses cursor inbox pages and retains structured conflict details', async () => {
    const fetch = vi.fn<FetchLike>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [contribution], nextCursor: 'opaque', openCount: 1 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { code: 'CONTRIBUTION_CONFLICT', message: 'conflict' },
        conflicts: [{ key: 'alpha', reason: 'overlapping-change' }],
      }), { status: 409 }))
    const api = new WorkspaceApi('https://api.example.test/', { fetch, clientId: () => 'learner' })

    await expect(api.listAccountContributions('review')).resolves.toMatchObject({
      items: [{ id: 'contribution-1' }],
      nextCursor: 'opaque',
      openCount: 1,
    })
    await expect(api.mergeContribution('catalog-1', 'contribution-1')).rejects.toMatchObject({
      status: 409,
      code: 'CONTRIBUTION_CONFLICT',
      details: { conflicts: [{ key: 'alpha', reason: 'overlapping-change' }] },
    })
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

  it('loads lightweight catalog metadata and a server-filtered word page separately', async () => {
    const word = { word: 'resilient', phonetic: '/rɪˈzɪliənt/', source: 'user', meanings: [{ pos: 'adjective', definition: 'Able to recover.' }] }
    const fetch = vi.fn<FetchLike>()
      .mockResolvedValueOnce(new Response(JSON.stringify(catalog())))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [word],
        total: 1,
        page: 1,
        pageSize: 50,
        totalPages: 1,
      })))
    const api = new WorkspaceApi('https://api.example.test/', { fetch, clientId: () => 'learner' })

    const summary = await api.getCatalogSummary('catalog-1')
    expect(summary).toMatchObject({ id: 'catalog-1', wordCount: 20 })
    expect(summary).not.toHaveProperty('words')
    await expect(api.listCatalogWords('catalog-1', { page: 1, pageSize: 50, q: ' resilient ' })).resolves.toMatchObject({
      items: [{ word: 'resilient' }],
      total: 1,
      page: 1,
      totalPages: 1,
    })
    expect(fetch.mock.calls.map(([url]) => url.toString())).toEqual([
      'https://api.example.test/api/catalog/wordbooks/catalog-1/summary',
      'https://api.example.test/api/catalog/wordbooks/catalog-1/words?page=1&pageSize=50&q=resilient',
    ])
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

  it('sends the previewed head revision with a snapshot update', async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(
      new Response(JSON.stringify(catalog({ sourceWordbookId: 'my-source-2', headRevisionId: 'revision-3' }))),
    )
    const api = new WorkspaceApi('https://api.example.test/', { fetch, clientId: () => 'learner' })

    await api.updateCatalogSnapshot('catalog-1', {
      sourceWordbookId: 'my-source-2',
      expectedHeadRevisionId: 'revision-2',
      message: '更新快照',
    })

    expect(fetch).toHaveBeenCalledWith(
      new URL('https://api.example.test/api/catalog/wordbooks/catalog-1'),
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          sourceWordbookId: 'my-source-2',
          expectedHeadRevisionId: 'revision-2',
          message: '更新快照',
        }),
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

describe('WorkspaceApi personal word pages', () => {
  it('requests a server-filtered page and preserves full-book level counts', async () => {
    const word = {
      id: 'word-1',
      word: 'resilient',
      phonetic: '/rɪˈzɪliənt/',
      addedAt: '2026-01-01T09:00:00.000Z',
      source: 'user',
      meanings: [{ pos: 'adjective', definition: 'Able to recover.' }],
      status: 'new',
      level: 0,
      reviewIntervalDays: 0,
      recognitionStreak: 0,
    }
    const payload = {
      items: [word],
      total: 1,
      page: 1,
      pageSize: 50,
      totalPages: 1,
      totalWordCount: 4_000,
      levelCounts: { l0: 900, l1: 800, l2: 800, l3: 800, l4: 700 },
    }
    const fetch = vi.fn<FetchLike>().mockResolvedValue(new Response(JSON.stringify(payload)))
    const api = new WorkspaceApi('https://api.example.test/', { fetch, clientId: () => 'learner' })

    await expect(api.listWordPage('my-book', { page: 1, pageSize: 50, q: ' resilient ', level: 0 })).resolves.toEqual(payload)
    expect(fetch).toHaveBeenCalledWith(
      new URL('https://api.example.test/api/my/wordbooks/my-book/words/page?page=1&pageSize=50&q=resilient&level=0'),
      expect.any(Object),
    )
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

  it('automatically queues selections above the server 500-word limit', async () => {
    const fetch = vi.fn<FetchLike>().mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { action: 'mark-mastered'; wordIds: string[] }
      return new Response(JSON.stringify({ action: body.action, succeededIds: body.wordIds, failed: [] }))
    })
    const api = new WorkspaceApi('https://api.example.test/', { fetch, clientId: () => 'learner' })
    const ids = Array.from({ length: 501 }, (_, index) => `word-${index}`)

    await expect(api.batchWords('my-book', 'mark-mastered', ids)).resolves.toEqual({
      action: 'mark-mastered',
      succeededIds: ids,
      failed: [],
    })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)).wordIds).toHaveLength(500)
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body)).wordIds).toHaveLength(1)
  })
})

describe('WorkspaceApi meaning-choice language', () => {
  it('requests options in the currently selected language', async () => {
    const payload = {
      taskId: 'task-1',
      wordId: 'word-1',
      options: [{ wordId: 'word-1', word: 'resilient', pos: 'adjective', definition: 'Able to recover.' }],
    }
    const fetch = vi.fn<FetchLike>().mockImplementation(
      async () => new Response(JSON.stringify(payload)),
    )
    const api = new WorkspaceApi('https://api.example.test/', { fetch, clientId: () => 'learner' })

    await api.getStudyRoundTaskOptions('round-1', 'task-1', 'zh')
    await api.getStudyRoundTaskOptions('round-1', 'task-1', 'en')

    expect(fetch.mock.calls.map(([url]) => url.toString())).toEqual([
      'https://api.example.test/api/study/rounds/round-1/tasks/task-1/options?meaningPreference=zh',
      'https://api.example.test/api/study/rounds/round-1/tasks/task-1/options?meaningPreference=en',
    ])
  })

  it('validates a present current word and aligns it with the active round task', async () => {
    const currentWord = {
      id: 'word-1',
      word: 'resilient',
      phonetic: '/rɪˈzɪliənt/',
      addedAt: '2026-08-02T00:00:00.000Z',
      source: 'user',
      meanings: [{ pos: 'adjective', definition: 'Able to recover.' }],
      status: 'new',
      level: 0,
      reviewIntervalDays: 0,
      recognitionStreak: 0,
    }
    const activeRound = {
      id: 'round-1', wordbookId: 'my-book', mode: 'new', scope: 'standard', meaningPreference: 'zh',
      exerciseTypes: ['self-rating'], wordIds: ['word-1'],
      queue: [{ id: 'task-1', wordId: 'word-1', exercise: 'self-rating' }],
      passedTaskKeys: [], completedWordIds: [], masteredWordIds: [], vagueWordIds: [], unknownWordIds: [],
      processedOperationIds: [], revision: 0,
      createdAt: '2026-08-02T00:00:00.000Z', updatedAt: '2026-08-02T00:00:00.000Z',
      expiresAt: '2026-08-03T00:00:00.000Z', currentWord,
    }
    const fetch = vi.fn<FetchLike>()
      .mockResolvedValueOnce(new Response(JSON.stringify(activeRound)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...activeRound, currentWord: { ...currentWord, id: 'word-2' } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...activeRound, currentWord: { ...currentWord, level: undefined } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...activeRound, currentWord: null })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...activeRound, queue: [], completedAt: activeRound.updatedAt, currentWord: null })))
    const api = new WorkspaceApi('https://api.example.test/', { fetch, clientId: () => 'learner' })

    await expect(api.getStudyRound('round-1')).resolves.toEqual(expect.objectContaining({ currentWord }))
    await expect(api.getStudyRound('round-1')).rejects.toThrow('Backend response is invalid')
    await expect(api.getStudyRound('round-1')).rejects.toThrow('Backend response is invalid')
    await expect(api.getStudyRound('round-1')).resolves.toEqual(expect.objectContaining({ currentWord: null }))
    await expect(api.getStudyRound('round-1')).resolves.toEqual(expect.objectContaining({ currentWord: null }))
  })

  it('posts the direct mastered action without requiring a card flip', async () => {
    const round = {
      id: 'round-1', wordbookId: 'my-book', mode: 'new', scope: 'standard', meaningPreference: 'zh',
      exerciseTypes: ['self-rating'], wordIds: ['word-1'], queue: [], passedTaskKeys: ['word-1:self-rating'],
      completedWordIds: ['word-1'], masteredWordIds: ['word-1'], vagueWordIds: [], unknownWordIds: [],
      processedOperationIds: ['operation-1'], revision: 1,
      createdAt: '2026-08-02T00:00:00.000Z', updatedAt: '2026-08-02T00:01:00.000Z',
      expiresAt: '2026-08-03T00:01:00.000Z', completedAt: '2026-08-02T00:01:00.000Z',
      currentWord: null,
    }
    const fetch = vi.fn<FetchLike>().mockResolvedValue(new Response(JSON.stringify(round)))
    const api = new WorkspaceApi('https://api.example.test/', { fetch, clientId: () => 'learner' })

    await expect(api.answerStudyRound('round-1', {
      taskId: 'task-1', response: 'mastered', operationId: 'operation-1', revision: 0,
    })).resolves.toEqual(expect.objectContaining({ masteredWordIds: ['word-1'] }))
    expect(fetch).toHaveBeenCalledWith(
      new URL('https://api.example.test/api/study/rounds/round-1/answers'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ taskId: 'task-1', response: 'mastered', operationId: 'operation-1', revision: 0 }),
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
      vague: 's',
      pronounce: 'enter',
      known: 'd',
      mastered: 'r',
      flip: ' ',
      dictationPronounce: 'tab',
    }
    const preferences = {
      ...structuredClone(DEFAULT_STUDY_PREFERENCES),
      plan: { newWords: 32, dictation: 12, backlogReviews: 50 },
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
