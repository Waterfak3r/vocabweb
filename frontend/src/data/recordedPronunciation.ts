import { isValidWordQuery, normalizeWord } from '../domain/normalize'
import type { EnglishAccent } from './pronunciationPreferences'

export type RecordedPronunciation = {
  phonetic: string
  audioUrl?: string
}

type FetchLike = typeof globalThis.fetch

const cache = new Map<string, Promise<RecordedPronunciation | null>>()

function parsePronunciation(value: unknown): RecordedPronunciation | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as { phonetic?: unknown; audioUrl?: unknown }
  if (typeof candidate.phonetic !== 'string') return null
  if (candidate.audioUrl === undefined) return { phonetic: candidate.phonetic }
  if (typeof candidate.audioUrl !== 'string') return null
  try {
    const url = new URL(candidate.audioUrl)
    return url.protocol === 'https:'
      ? { phonetic: candidate.phonetic, audioUrl: url.toString() }
      : null
  } catch {
    return null
  }
}

export function getRecordedPronunciation(
  word: string,
  accent: EnglishAccent = 'gb',
  fetchFn: FetchLike = globalThis.fetch,
): Promise<RecordedPronunciation | null> {
  const query = normalizeWord(word)
  if (!isValidWordQuery(query)) return Promise.resolve(null)
  const cacheKey = `${accent}:${query}`
  const existing = cache.get(cacheKey)
  if (existing) return existing

  const request = fetchFn(`/api/pronunciations/${encodeURIComponent(query)}?accent=${accent}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(6500),
  }).then(async (response) => {
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`Pronunciation lookup failed (${response.status})`)
    return parsePronunciation(await response.json())
  }).catch(() => {
    cache.delete(cacheKey)
    return null
  })
  cache.set(cacheKey, request)
  return request
}
