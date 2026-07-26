import type { WordbookItem } from '../domain/types'
import { storageKey } from '../lib/storage'

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

export type StudySummary = {
  date: string
  wordbookTotal: number
  addedToday: number
  lookupCount: number
  review: {
    due: number
    completedToday: number
  }
  dictation: {
    due: number
    completedToday: number
  }
  dailyGoal: {
    target: number
    completed: number
  }
  updatedAt: string
}

export type StudyEvent =
  | { kind: 'new' | 'lookup'; word: string; wordbookId?: string }
  | { kind: 'flashcard'; word: string; verdict: 'know' | 'unknown'; wordbookId?: string }
  | { kind: 'dictation'; word: string; correct: boolean; wordbookId?: string }

type StudyApiOptions = {
  fetch?: FetchLike
  timeoutMs?: number
  clientId?: () => string
}

const CLIENT_ID_KEY = storageKey('client-id', 1)
const DEFAULT_TIMEOUT_MS = 8_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function parseCounter(value: unknown): { due: number; completedToday: number } | null {
  if (!isRecord(value) || !isCount(value.due) || !isCount(value.completedToday)) return null
  return { due: value.due, completedToday: value.completedToday }
}

function parseDailyGoal(value: unknown): { target: number; completed: number } | null {
  if (!isRecord(value) || !isCount(value.target) || !isCount(value.completed)) return null
  return { target: value.target, completed: value.completed }
}

function parseStudySummary(value: unknown): StudySummary | null {
  if (!isRecord(value)) return null
  if (
    typeof value.date !== 'string' ||
    !isCount(value.wordbookTotal) ||
    !isCount(value.addedToday) ||
    !isCount(value.lookupCount) ||
    typeof value.updatedAt !== 'string'
  ) {
    return null
  }

  const review = parseCounter(value.review)
  const dictation = parseCounter(value.dictation)
  const dailyGoal = parseDailyGoal(value.dailyGoal)
  if (!review || !dictation || !dailyGoal) return null

  return {
    date: value.date,
    wordbookTotal: value.wordbookTotal,
    addedToday: value.addedToday,
    lookupCount: value.lookupCount,
    review,
    dictation,
    dailyGoal,
    updatedAt: value.updatedAt,
  }
}

function buildApiBase(baseUrl: string): URL {
  const trimmed = baseUrl.trim()
  if (!trimmed) throw new TypeError('Backend API base URL must not be empty.')

  const url = new URL(trimmed)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError('Backend API base URL must use HTTP or HTTPS.')
  }

  url.search = ''
  url.hash = ''
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url
}

function newClientId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

/** A stable anonymous identifier lets the backend keep a learner's daily record. */
export function getStudyClientId() {
  try {
    const existing = window.localStorage.getItem(CLIENT_ID_KEY)?.trim()
    if (existing) return existing

    const clientId = newClientId()
    window.localStorage.setItem(CLIENT_ID_KEY, clientId)
    return clientId
  } catch {
    // Privacy-mode storage can fail; retaining an in-memory ID still keeps the request valid.
    return newClientId()
  }
}

/** HTTP client for the optional study-record backend. */
export class StudyApi {
  private readonly baseUrl: URL
  private readonly fetch: FetchLike
  private readonly timeoutMs: number
  private readonly clientId: () => string

  constructor(baseUrl: string, options: StudyApiOptions = {}) {
    this.baseUrl = buildApiBase(baseUrl)
    this.fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init))
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.clientId = options.clientId ?? getStudyClientId
  }

  async getSummary(): Promise<StudySummary> {
    const response = await this.request('api/study/summary')
    if (!response.ok) throw new Error(`Study summary request failed (${response.status}).`)

    let payload: unknown
    try {
      payload = await response.json()
    } catch (cause) {
      throw new Error('Study summary response is not valid JSON.', { cause })
    }

    const summary = parseStudySummary(payload)
    if (!summary) throw new Error('Study summary response does not match the expected shape.')
    return summary
  }

  async record(event: StudyEvent): Promise<void> {
    const response = await this.request('api/study/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    })
    if (!response.ok) throw new Error(`Study event request failed (${response.status}).`)
  }

  private request(path: string, init: RequestInit = {}) {
    return this.fetch(new URL(path, this.baseUrl), {
      ...init,
      headers: {
        'X-Vocab-Client-Id': this.clientId(),
        ...init.headers,
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    })
  }
}

const configuredApiBase = import.meta.env.VITE_API_BASE?.trim()
const studyApi = configuredApiBase ? new StudyApi(configuredApiBase) : null

export function hasStudyApi() {
  return studyApi !== null
}

export function getStudySummary() {
  if (!studyApi) return Promise.reject(new Error('Study API is not configured.'))
  return studyApi.getSummary()
}

/**
 * Reporting never owns the UI flow: callers intentionally ignore a failed request
 * so lookup, review, and dictation remain usable while offline.
 */
export function recordStudyEvent(event: StudyEvent) {
  if (!studyApi) return Promise.resolve()
  return studyApi.record(event)
}

function countItemsAddedToday(items: readonly WordbookItem[]) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  return items.filter((item) => {
    const addedAt = new Date(item.addedAt).getTime()
    return Number.isFinite(addedAt) && addedAt >= today.getTime() && addedAt < tomorrow.getTime()
  }).length
}

/**
 * Honest offline fallback: only derive values the local wordbook can prove.
 * Completion counters and goals remain zero and are not presented as activity.
 */
export function deriveLocalStudySummary(items: readonly WordbookItem[]): StudySummary {
  const now = new Date()
  return {
    date: now.toISOString().slice(0, 10),
    wordbookTotal: items.length,
    addedToday: countItemsAddedToday(items),
    lookupCount: 0,
    review: { due: items.length, completedToday: 0 },
    dictation: { due: items.length, completedToday: 0 },
    dailyGoal: { target: 0, completed: 0 },
    updatedAt: now.toISOString(),
  }
}
