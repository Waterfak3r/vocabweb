import { describe, expect, it, vi } from 'vitest'
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

    await expect(api.createImportDraft({ title: '导入测试', lines: [{ line: 1, word: 'resilient' }] })).resolves.toMatchObject({ status: 'processing' })
    await expect(api.processImportDraft('draft-1')).resolves.toMatchObject({
      status: 'processing',
      entries: [{ status: 'processing' }],
    })

    expect(fetch.mock.calls.map(([url, init]) => [url.toString(), init?.method])).toEqual([
      ['https://api.example.test/api/my/import-drafts', 'POST'],
      ['https://api.example.test/api/my/import-drafts/draft-1/process', 'POST'],
    ])
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
    favorited: true,
    added: false,
    uploaded: true,
    visibility: 'unlisted',
    ...overrides,
  }
}

describe('WorkspaceApi marketplace owner feeds', () => {
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
