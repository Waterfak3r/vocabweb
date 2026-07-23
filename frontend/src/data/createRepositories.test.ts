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
  it('keeps the local IELTS repository first when a backend is configured', async () => {
    const fetch = vi.fn<FetchLike>(async () => {
      throw new Error('local entries must not call the backend')
    })
    vi.stubGlobal('fetch', fetch)
    const repository = createWordRepository('https://backend.example.test')

    await expect(repository.lookup('resilient')).resolves.toMatchObject({
      word: 'resilient',
      source: 'local-ielts',
    })
    expect(fetch).not.toHaveBeenCalled()
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

  it('preserves the direct dictionary fallback when no API base is set', async () => {
    const fetch = vi.fn<FetchLike>(async () =>
      jsonResponse([
        {
          word: 'serendipity',
          phonetic: '',
          meanings: [
            {
              partOfSpeech: 'noun',
              definitions: [{ definition: 'A fortunate discovery.' }],
            },
          ],
        },
      ]),
    )
    vi.stubGlobal('fetch', fetch)
    const repository = createWordRepository('')

    await expect(repository.lookup('serendipity')).resolves.toMatchObject({
      word: 'serendipity',
      source: 'dictionary-api',
    })
    expect(fetch.mock.calls[0][0].toString()).toContain(
      'api.dictionaryapi.dev/api/v2/entries/en/serendipity',
    )
  })
})
