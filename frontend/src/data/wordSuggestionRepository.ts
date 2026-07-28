import { isValidWordQuery, normalizeWord } from '../domain/normalize'
import { resolveApiBase } from './resolveApiBase'

export type WordSuggestion = {
  word: string
  zhMeaning?: string
  kind: 'word' | 'phrase'
}

export interface WordSuggestionRepository {
  suggest(query: string, limit?: number, signal?: AbortSignal): Promise<WordSuggestion[]>
}

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export class BackendWordSuggestionRepository implements WordSuggestionRepository {
  private readonly baseUrl: URL
  private readonly fetch: FetchLike

  constructor(baseUrl: string, fetchFn: FetchLike = globalThis.fetch.bind(globalThis)) {
    this.baseUrl = resolveApiBase(baseUrl)
    this.fetch = fetchFn
  }

  async suggest(rawQuery: string, limit = 8, signal?: AbortSignal): Promise<WordSuggestion[]> {
    const trimmed = rawQuery.trim().replace(/\s+/g, ' ')
    const chinese = /^[\p{Script=Han}\s]{2,24}$/u.test(trimmed)
    const query = chinese ? trimmed : normalizeWord(trimmed)
    if (query.length < 2 || (!chinese && !isValidWordQuery(query))) return []

    const url = new URL('api/words/suggestions', this.baseUrl)
    url.searchParams.set('q', query)
    url.searchParams.set('limit', String(limit))
    const response = await this.fetch(url, { signal })
    if (!response.ok) throw new Error(`Suggestion request failed with HTTP ${response.status}`)

    const payload: unknown = await response.json()
    if (!isRecord(payload) || !Array.isArray(payload.suggestions)) {
      throw new Error('Suggestion response is invalid')
    }

    return payload.suggestions.flatMap((value): WordSuggestion[] => {
      if (!isRecord(value) || typeof value.word !== 'string') return []
      const word = normalizeWord(value.word)
      if (!isValidWordQuery(word)) return []
      if (value.zhMeaning !== undefined && typeof value.zhMeaning !== 'string') return []
      const zhMeaning = value.zhMeaning?.trim()
      // Keep rolling deployments usable when the frontend is updated before an
      // older backend that does not yet emit `kind`.
      const kind = value.kind === 'word' || value.kind === 'phrase'
        ? value.kind
        : word.includes(' ') ? 'phrase' : 'word'
      return [{ word, kind, ...(zhMeaning ? { zhMeaning } : {}) }]
    })
  }
}
