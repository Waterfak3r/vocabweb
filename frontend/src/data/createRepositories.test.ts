import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWordRepository } from './createRepositories'

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createWordRepository', () => {
  it('uses the bilingual backend even for words in the offline IELTS sample', async () => {
    const fetch = vi.fn<FetchLike>(async () => jsonResponse({
      word: 'resilient',
      phonetic: '',
      meanings: [{ pos: 'adjective', definition: 'Able to recover.' }],
      zhMeaning: '有韧性的',
      availableLanguages: ['zh', 'en'],
      source: 'backend',
    }))
    vi.stubGlobal('fetch', fetch)
    const repository = createWordRepository('https://backend.example.test')

    await expect(repository.lookup('resilient')).resolves.toMatchObject({
      word: 'resilient',
      source: 'backend',
      zhMeaning: '有韧性的',
    })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('uses the backend exclusively for non-local words when configured', async () => {
    const fetch = vi.fn<FetchLike>(async () =>
      jsonResponse({
        word: 'serendipity',
        phonetic: '',
        meanings: [{ pos: 'noun', definition: 'A fortunate discovery.' }],
        source: 'backend',
      }),
    )
    vi.stubGlobal('fetch', fetch)
    const repository = createWordRepository('https://backend.example.test/')

    await expect(repository.lookup('serendipity')).resolves.toMatchObject({
      word: 'serendipity',
      source: 'backend',
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0].toString()).toContain(
      'backend.example.test/api/words/serendipity',
    )
  })

  it('uses the same-origin backend when no API base is set', async () => {
    const fetch = vi.fn<FetchLike>(async () =>
      jsonResponse({
        word: 'serendipity',
        phonetic: '',
        meanings: [{ pos: 'noun', definition: 'A fortunate discovery.' }],
        source: 'backend',
      }),
    )
    vi.stubGlobal('fetch', fetch)
    const repository = createWordRepository('')

    await expect(repository.lookup('serendipity')).resolves.toMatchObject({
      word: 'serendipity',
      source: 'backend',
    })
    expect(fetch.mock.calls[0][0].toString()).toContain(
      'localhost/api/words/serendipity',
    )
  })
})
