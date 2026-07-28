import { describe, expect, it, vi } from 'vitest'
import { BackendWordSuggestionRepository } from './wordSuggestionRepository'

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('BackendWordSuggestionRepository', () => {
  it('normalizes the query, parses suggestions, and forwards cancellation', async () => {
    const fetch = vi.fn<FetchLike>(async () => jsonResponse({
      suggestions: [
        { word: 'A LOT OF', zhMeaning: ' 许多 ' },
        { word: 'look up' },
      ],
    }))
    const repository = new BackendWordSuggestionRepository(
      'https://example.test/root/',
      fetch,
    )
    const controller = new AbortController()

    await expect(repository.suggest('  A   LOT ', 8, controller.signal)).resolves.toEqual([
      { word: 'a lot of', zhMeaning: '许多' },
      { word: 'look up' },
    ])
    const [url, init] = fetch.mock.calls[0]
    expect(url.toString()).toBe(
      'https://example.test/root/api/words/suggestions?q=a+lot&limit=8',
    )
    expect(init?.signal).toBe(controller.signal)
  })

  it('does not request candidates before two valid characters', async () => {
    const fetch = vi.fn<FetchLike>()
    const repository = new BackendWordSuggestionRepository('https://example.test', fetch)

    await expect(repository.suggest('a')).resolves.toEqual([])
    await expect(repository.suggest('12')).resolves.toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects unsuccessful and malformed responses', async () => {
    const failed = new BackendWordSuggestionRepository(
      'https://example.test',
      async () => jsonResponse({}, 429),
    )
    await expect(failed.suggest('res')).rejects.toThrow('HTTP 429')

    const malformed = new BackendWordSuggestionRepository(
      'https://example.test',
      async () => jsonResponse({ suggestions: 'not-an-array' }),
    )
    await expect(malformed.suggest('res')).rejects.toThrow('response is invalid')
  })
})
