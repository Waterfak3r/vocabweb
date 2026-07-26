import { describe, expect, it, vi } from 'vitest'
import { BackendWordRepository } from './backendWordRepository'
import { LookupError } from './wordRepository'

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function backendEntry(overrides: Record<string, unknown> = {}) {
  return {
    word: 'serendipity',
    phonetic: '/ˌserənˈdɪpəti/',
    audioUrl: 'https://cdn.example.test/serendipity.mp3',
    meanings: [
      {
        pos: 'NOUN',
        definition: '  A fortunate discovery.  ',
        example: '  It happened by serendipity.  ',
      },
    ],
    source: 'backend',
    ...overrides,
  }
}

describe('BackendWordRepository', () => {
  it('safely joins the base URL, encodes the word, and normalizes a valid DTO', async () => {
    const fetch = vi.fn<FetchLike>(async () => jsonResponse(backendEntry()))
    const repository = new BackendWordRepository(
      'https://example.test/root?discard=yes#fragment',
      { fetch },
    )

    await expect(repository.lookup('  SERENDIPITY ')).resolves.toEqual({
      word: 'serendipity',
      phonetic: '/ˌserənˈdɪpəti/',
      audioUrl: 'https://cdn.example.test/serendipity.mp3',
      meanings: [
        {
          pos: 'noun',
          definition: 'A fortunate discovery.',
          example: 'It happened by serendipity.',
        },
      ],
      source: 'backend',
    })

    const [url] = fetch.mock.calls[0]
    expect(url.toString()).toBe(
      'https://example.test/root/api/words/serendipity',
    )
  })

  it('folds curly apostrophes before building the request URL', async () => {
    const fetch = vi.fn<FetchLike>(async () =>
      jsonResponse(backendEntry({ word: "rock'n'roll" })),
    )
    const repository = new BackendWordRepository('https://example.test/', {
      fetch,
    })

    await repository.lookup('rock’n’roll')

    const [url] = fetch.mock.calls[0]
    expect(url.toString()).toBe("https://example.test/api/words/rock'n'roll")
  })

  it('calls the default global fetch with its required host binding', async () => {
    const globalFetch = vi.fn(function (
      this: typeof globalThis,
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) {
      if (this !== globalThis) {
        throw new TypeError('Illegal invocation')
      }
      return Promise.resolve(jsonResponse(backendEntry()))
    })
    vi.stubGlobal('fetch', globalFetch)

    try {
      const repository = new BackendWordRepository('https://example.test')

      await expect(repository.lookup('serendipity')).resolves.toMatchObject({
        word: 'serendipity',
        source: 'backend',
      })
      expect(globalFetch).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('returns null for 404 and does not fetch invalid queries', async () => {
    const fetch = vi.fn<FetchLike>(async () =>
      jsonResponse({ error: {} }, 404),
    )
    const repository = new BackendWordRepository('https://example.test', {
      fetch,
    })

    await expect(repository.lookup('missing')).resolves.toBeNull()
    await expect(repository.lookup('two words')).resolves.toBeNull()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('maps stable backend error codes to UI-safe LookupErrors', async () => {
    const fetch = vi.fn<FetchLike>(async () =>
      jsonResponse(
        {
          error: {
            code: 'UPSTREAM_TIMEOUT',
            message: 'Provider timed out',
          },
        },
        504,
      ),
    )
    const repository = new BackendWordRepository('https://example.test', {
      fetch,
    })

    const error = await repository.lookup('serendipity').catch((cause) => cause)
    expect(error).toBeInstanceOf(LookupError)
    expect(error).toMatchObject({
      code: 'network',
      message: '词典响应超时，请重试。',
    })
  })

  it('maps rate limiting to an actionable Chinese message', async () => {
    const fetch = vi.fn<FetchLike>(async () =>
      jsonResponse(
        {
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many requests',
          },
        },
        429,
      ),
    )
    const repository = new BackendWordRepository('https://example.test', {
      fetch,
    })

    await expect(repository.lookup('serendipity')).rejects.toMatchObject({
      name: 'LookupError',
      code: 'http',
      message: '查询太频繁，请稍后再试。',
    })
  })

  it.each([
    ['wrong source', backendEntry({ source: 'dictionary-api' })],
    ['mismatched word', backendEntry({ word: 'different' })],
    ['empty meanings', backendEntry({ meanings: [] })],
    ['unsafe audio URL', backendEntry({ audioUrl: 'http://example.test/a.mp3' })],
  ])('rejects a bad 200 DTO: %s', async (_label, payload) => {
    const repository = new BackendWordRepository('https://example.test', {
      fetch: async () => jsonResponse(payload),
    })

    await expect(repository.lookup('serendipity')).rejects.toMatchObject({
      name: 'LookupError',
      code: 'parse',
    })
  })
})
