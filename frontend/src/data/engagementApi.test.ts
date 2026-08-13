import { describe, expect, it, vi } from 'vitest'
import { EngagementApi } from './engagementApi'

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

describe('EngagementApi', () => {
  it('reports successful searches and parses the popular list', async () => {
    const fetch = vi.fn<FetchLike>()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ word: 'resilient', count: 4, trend: 2 }])))
    const api = new EngagementApi('https://example.test/', { fetch, clientId: () => 'learner' })

    await api.reportSearch('resilient')
    await expect(api.listPopularSearches()).resolves.toEqual([{ word: 'resilient', count: 4, trend: 2 }])
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

  it('lists, creates, edits, and marks message notifications read', async () => {
    const message = {
      id: '11111111-1111-1111-1111-111111111111',
      rootId: '11111111-1111-1111-1111-111111111111',
      depth: 0,
      author: '访客',
      avatarUrl: null,
      content: '你好',
      status: 'active',
      createdAt: '2026-07-28T00:00:00.000Z',
      updatedAt: '2026-07-28T00:00:00.000Z',
      edited: false,
      canEdit: true,
      canDelete: true,
    }
    const fetch = vi.fn<FetchLike>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [message], nextCursor: 'next' })))
      .mockResolvedValueOnce(new Response(JSON.stringify(message), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...message, content: '已修改', edited: true })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ count: 2 })))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    const api = new EngagementApi('https://example.test/', { fetch, clientId: () => 'learner' })
    await expect(api.listMessages()).resolves.toEqual({ items: [message], nextCursor: 'next' })
    await api.createMessage({ nickname: '访客', content: '你好' })
    await api.editMessage(message.id, '已修改')
    await expect(api.unreadMessageCount()).resolves.toBe(2)
    await api.markMessagesRead()
    expect(fetch.mock.calls.map(([url]) => url.toString())).toEqual([
      'https://example.test/api/messages?limit=20',
      'https://example.test/api/messages',
      `https://example.test/api/messages/${message.id}`,
      'https://example.test/api/messages/unread-count',
      'https://example.test/api/messages/read',
    ])
  })
})
