import { getStudyClientId } from './studyApi'
import { resolveApiBase } from './resolveApiBase'

export type PopularSearch = { word: string; count: number; trend: number }
export type FeedbackType = 'suggestion' | 'bug' | 'other'
export type FeedbackInput = {
  type: FeedbackType
  message: string
  contact?: string
  page?: string
}
export type Message = {
  id: string
  parentId?: string
  rootId: string
  depth: 0 | 1 | 2
  author: string
  replyTo?: string
  contact?: string
  content?: string
  status: 'active' | 'deleted' | 'hidden'
  createdAt: string
  updatedAt: string
  edited: boolean
  canEdit: boolean
  canDelete: boolean
}
export type MessagePage = { items: Message[]; nextCursor?: string }
export type SiteSettings = { donationImageUrl: string | null }

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
      const { word, count, trend } = item as Record<string, unknown>
      return typeof word === 'string' && typeof count === 'number' && Number.isFinite(count) && typeof trend === 'number' && Number.isFinite(trend)
        ? [{ word, count, trend }]
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

  async listMessages(cursor?: string, limit = 20): Promise<MessagePage> {
    const url = new URL('api/messages', this.baseUrl)
    if (cursor) url.searchParams.set('cursor', cursor)
    url.searchParams.set('limit', String(limit))
    const payload = await this.json(url)
    if (!payload || typeof payload !== 'object' || !Array.isArray((payload as Record<string, unknown>).items)) throw new Error('留言数据无效。')
    const record = payload as Record<string, unknown>
    const rawItems = record.items as unknown[]
    const items = rawItems.map(parseMessage)
    if (items.some((item) => item === null) || (record.nextCursor !== undefined && typeof record.nextCursor !== 'string')) throw new Error('留言数据无效。')
    return { items: items as Message[], ...(typeof record.nextCursor === 'string' ? { nextCursor: record.nextCursor } : {}) }
  }

  async createMessage(input: { content: string; nickname?: string; contact?: string; parentId?: string }): Promise<Message> {
    return this.messageMutation('api/messages', { method: 'POST', body: JSON.stringify(input) })
  }

  async editMessage(id: string, content: string): Promise<Message> {
    return this.messageMutation(`api/messages/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ content }) })
  }

  async deleteMessage(id: string): Promise<void> {
    await this.empty(`api/messages/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  async moderateMessage(id: string, action: 'hide' | 'restore'): Promise<void> {
    await this.empty(`api/messages/${encodeURIComponent(id)}/moderation`, { method: 'PATCH', body: JSON.stringify({ action }) })
  }

  async permanentlyDeleteMessage(id: string): Promise<void> {
    await this.empty(`api/messages/${encodeURIComponent(id)}/permanent`, { method: 'DELETE' })
  }

  async unreadMessageCount(): Promise<number> {
    const payload = await this.json(new URL('api/messages/unread-count', this.baseUrl))
    const count = payload && typeof payload === 'object' ? (payload as Record<string, unknown>).count : undefined
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) throw new Error('未读数无效。')
    return count
  }

  async markMessagesRead(): Promise<void> {
    await this.empty('api/messages/read', { method: 'POST' })
  }

  async siteSettings(): Promise<SiteSettings> {
    return parseSiteSettings(await this.json(new URL('api/site-settings', this.baseUrl)))
  }

  async adminSiteSettings(): Promise<SiteSettings> {
    return parseSiteSettings(await this.json(new URL('api/admin/site-settings', this.baseUrl)))
  }

  async updateSiteSettings(donationImageUrl: string | null): Promise<SiteSettings> {
    return parseSiteSettings(await this.json(new URL('api/admin/site-settings', this.baseUrl), {
      method: 'PATCH',
      body: JSON.stringify({ donationImageUrl }),
    }))
  }

  private headers() {
    return { 'content-type': 'application/json', 'X-Vocab-Client-Id': this.clientId() }
  }

  private async json(url: URL, init: RequestInit = {}): Promise<unknown> {
    const response = await this.fetch(url, { ...init, credentials: 'include', headers: { ...this.headers(), ...init.headers } })
    if (!response.ok) throw new Error(`请求失败（${response.status}）。`)
    return response.json()
  }

  private async messageMutation(path: string, init: RequestInit): Promise<Message> {
    const payload = await this.json(new URL(path, this.baseUrl), init)
    const message = parseMessage(payload)
    if (!message) throw new Error('留言数据无效。')
    return message
  }

  private async empty(path: string, init: RequestInit): Promise<void> {
    const response = await this.fetch(new URL(path, this.baseUrl), { ...init, credentials: 'include', headers: { ...this.headers(), ...init.headers } })
    if (!response.ok) throw new Error(`请求失败（${response.status}）。`)
  }
}

function parseSiteSettings(value: unknown): SiteSettings {
  if (!value || typeof value !== 'object') throw new Error('站点设置无效。')
  const donationImageUrl = (value as Record<string, unknown>).donationImageUrl
  if (donationImageUrl !== null && typeof donationImageUrl !== 'string') throw new Error('站点设置无效。')
  return { donationImageUrl }
}

function parseMessage(value: unknown): Message | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  if (typeof item.id !== 'string' || typeof item.rootId !== 'string'
    || (item.depth !== 0 && item.depth !== 1 && item.depth !== 2)
    || typeof item.author !== 'string'
    || (item.status !== 'active' && item.status !== 'deleted' && item.status !== 'hidden')
    || typeof item.createdAt !== 'string' || typeof item.updatedAt !== 'string'
    || typeof item.edited !== 'boolean' || typeof item.canEdit !== 'boolean' || typeof item.canDelete !== 'boolean'
    || (item.parentId !== undefined && typeof item.parentId !== 'string')
    || (item.replyTo !== undefined && typeof item.replyTo !== 'string')
    || (item.contact !== undefined && typeof item.contact !== 'string')
    || (item.content !== undefined && typeof item.content !== 'string')) return null
  return {
    id: item.id,
    rootId: item.rootId,
    depth: item.depth,
    author: item.author,
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    edited: item.edited,
    canEdit: item.canEdit,
    canDelete: item.canDelete,
    ...(item.parentId ? { parentId: item.parentId } : {}),
    ...(item.replyTo ? { replyTo: item.replyTo } : {}),
    ...(item.contact ? { contact: item.contact } : {}),
    ...(item.content ? { content: item.content } : {}),
  }
}

let singleton: EngagementApi | null | undefined

export function getEngagementApi(): EngagementApi | null {
  if (singleton !== undefined) return singleton
  const base = import.meta.env.VITE_API_BASE?.trim()
  singleton = base ? new EngagementApi(base) : null
  return singleton
}
