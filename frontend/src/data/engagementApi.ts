import { getStudyClientId } from './studyApi'
import { resolveApiBase } from './resolveApiBase'

export type PopularSearch = { word: string; count: number }
export type FeedbackType = 'suggestion' | 'bug' | 'other'
export type FeedbackInput = {
  type: FeedbackType
  message: string
  contact?: string
  page?: string
}

type FetchLike = typeof fetch
type EngagementApiOptions = {
  fetch?: FetchLike
  clientId?: () => string
}

export class EngagementApi {
  private readonly baseUrl: URL
  private readonly fetch: FetchLike
  private readonly clientId: () => string

  constructor(baseUrl: string, options: EngagementApiOptions = {}) {
    this.baseUrl = resolveApiBase(baseUrl)
    this.fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init))
    this.clientId = options.clientId ?? getStudyClientId
  }

  async reportSearch(word: string): Promise<void> {
    const response = await this.fetch(new URL('api/searches', this.baseUrl), {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        'X-Vocab-Client-Id': this.clientId(),
      },
      body: JSON.stringify({ word }),
    })
    if (!response.ok) throw new Error(`Search reporting failed (${response.status}).`)
  }

  async listPopularSearches(days = 7, limit = 8): Promise<PopularSearch[]> {
    const url = new URL('api/searches/popular', this.baseUrl)
    url.searchParams.set('days', String(days))
    url.searchParams.set('limit', String(limit))
    const response = await this.fetch(url, {
      credentials: 'include',
      headers: { 'X-Vocab-Client-Id': this.clientId() },
    })
    if (!response.ok) throw new Error(`Popular searches failed (${response.status}).`)
    const payload: unknown = await response.json()
    if (!Array.isArray(payload)) throw new Error('Popular searches returned invalid data.')
    return payload.flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const { word, count } = item as Record<string, unknown>
      return typeof word === 'string' && typeof count === 'number' && Number.isFinite(count)
        ? [{ word, count }]
        : []
    }).slice(0, limit)
  }

  async submitFeedback(input: FeedbackInput): Promise<void> {
    const response = await this.fetch(new URL('api/feedback', this.baseUrl), {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        'X-Vocab-Client-Id': this.clientId(),
      },
      body: JSON.stringify(input),
    })
    if (!response.ok) throw new Error(`Feedback submission failed (${response.status}).`)
  }
}

let singleton: EngagementApi | null | undefined

export function getEngagementApi(): EngagementApi | null {
  if (singleton !== undefined) return singleton
  const base = import.meta.env.VITE_API_BASE?.trim()
  singleton = base ? new EngagementApi(base) : null
  return singleton
}
