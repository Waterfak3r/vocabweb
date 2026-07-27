import { describe, expect, it, vi } from 'vitest'
import { EngagementApi } from './engagementApi'

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

describe('EngagementApi', () => {
  it('reports successful searches and parses the popular list', async () => {
    const fetch = vi.fn<FetchLike>()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ word: 'resilient', count: 4 }])))
    const api = new EngagementApi('https://example.test/', { fetch, clientId: () => 'learner' })

    await api.reportSearch('resilient')
    await expect(api.listPopularSearches()).resolves.toEqual([{ word: 'resilient', count: 4 }])
    expect(fetch.mock.calls.map(([url, init]) => [url.toString(), init?.method ?? 'GET'])).toEqual([
      ['https://example.test/api/searches', 'POST'],
      ['https://example.test/api/searches/popular?days=7&limit=8', 'GET'],
    ])
  })

  it('keeps feedback fields and current page in the request body', async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(new Response(JSON.stringify({ id: 'one' }), { status: 201 }))
    const api = new EngagementApi('https://example.test/', { fetch, clientId: () => 'learner' })
    await api.submitFeedback({ type: 'suggestion', message: '建议', contact: 'mail', page: '/wordbook' })
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      type: 'suggestion',
      message: '建议',
      contact: 'mail',
      page: '/wordbook',
    })
  })
})
