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
