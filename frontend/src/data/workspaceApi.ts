import type { WordbookItem, WordEntry, WordMeaning, WordSource } from '../domain/types'
import { getStudyClientId } from './studyApi'

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export type CatalogSort = 'recommended' | 'hot' | 'newest' | 'rating'
export type CatalogExam = 'IELTS' | 'TOEFL' | 'GRE' | '高考' | '四六级' | '考研'
export type LearningGoal = '写作' | '阅读' | '听力' | '口语'
export type CatalogQuery = { q?: string; exam?: CatalogExam; goal?: LearningGoal; sort?: CatalogSort }
export type WordStatus = 'new' | 'learning' | 'review' | 'mastered'

export type CatalogWordbook = {
  id: string
  title: string
  description: string
  author: string
  exams: string[]
  goals: string[]
  rating: number
  uses: number
  createdAt: string
  shareCode: string
  wordCount: number
  favorited: boolean
  added: boolean
  uploaded: boolean
}

export type WordbookProgress = {
  mastered: number
  learning: number
  review: number
  unstudied: number
  percent: number
}

export type MyWordbook = {
  id: string
  title: string
  description: string
  sourceCatalogId?: string
  createdAt: string
  updatedAt: string
  wordCount: number
  progress: WordbookProgress
}

export type StudyDashboard = {
  wordbook: MyWordbook
  todayPlan: {
    new: { target: number; completed: number }
    review: { target: number; completed: number }
    dictation: { target: number; completed: number }
  }
  recentActivity: Array<{ id: string; kind: 'new' | 'flashcard' | 'dictation'; wordbookId: string; word: string; occurredAt: string; verdict?: 'know' | 'unknown'; correct?: boolean }>
  calendar: Array<{ date: string; count: number; active: boolean }>
  week: { newCount: number; reviewCount: number; dictationCount: number; total: number }
  streakDays: number
  updatedAt: string
}

export type LearningEvent =
  | { kind: 'new'; wordbookId: string; word: string }
  | { kind: 'flashcard'; wordbookId: string; word: string; verdict: 'know' | 'unknown' }
  | { kind: 'dictation'; wordbookId: string; word: string; correct: boolean }

export type ImportDraftLine = {
  line: number
  word: string
  zhMeaning?: string
}

export type ImportDraftStatus = 'processing' | 'ready' | 'invalid' | 'duplicate' | 'unmatched' | 'conflict'
export type ImportConflictResolution = 'keep' | 'replace' | 'merge' | 'discard'

export type ImportDraftEntry = ImportDraftLine & {
  id?: string
  status: ImportDraftStatus
  reason?: string
  conflictWith?: string
  resolution?: ImportConflictResolution
}

export type ImportDraft = {
  id: string
  groupId?: string
  title: string
  description: string
  entries: ImportDraftEntry[]
  batchIndex: number
  totalBatches: number
  targetWordbookId?: string
  status: 'processing' | 'pending' | 'committed'
  createdAt?: string
  updatedAt?: string
}

export type UpdateWordInput = {
  word?: string
  zhMeaning?: string | null
  phonetic?: string
  audioUrl?: string
  meanings?: WordMeaning[]
  /** Requests a fresh lookup only for the word being edited. */
  refresh?: boolean
}

type WorkspaceApiOptions = { fetch?: FetchLike; timeoutMs?: number; clientId?: () => string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isText(value: unknown): value is string { return typeof value === 'string' }
function isCount(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0 }
function textArray(value: unknown): string[] | null { return Array.isArray(value) && value.every(isText) ? value : null }

function parseProgress(value: unknown): WordbookProgress | null {
  if (!isRecord(value) || !isCount(value.mastered) || !isCount(value.learning) || !isCount(value.review) || !isCount(value.unstudied) || !isCount(value.percent)) return null
  return { mastered: value.mastered, learning: value.learning, review: value.review, unstudied: value.unstudied, percent: value.percent }
}

function parseMyWordbook(value: unknown): MyWordbook | null {
  if (!isRecord(value) || !isText(value.id) || !isText(value.title) || !isText(value.description) || !isText(value.createdAt) || !isText(value.updatedAt) || !isCount(value.wordCount)) return null
  const progress = parseProgress(value.progress)
  if (!progress || (value.sourceCatalogId !== undefined && !isText(value.sourceCatalogId))) return null
  return { id: value.id, title: value.title, description: value.description, sourceCatalogId: value.sourceCatalogId, createdAt: value.createdAt, updatedAt: value.updatedAt, wordCount: value.wordCount, progress }
}

function parseCatalog(value: unknown): CatalogWordbook | null {
  if (!isRecord(value) || !isText(value.id) || !isText(value.title) || !isText(value.description) || !isText(value.author) || !isCount(value.rating) || !isCount(value.uses) || !isText(value.createdAt) || !isText(value.shareCode) || !isCount(value.wordCount)) return null
  const exams = textArray(value.exams)
  const goals = textArray(value.goals)
  if (!exams || !goals) return null
  const favorited = typeof value.favorited === 'boolean' ? value.favorited : value.isFavorite
  const added = typeof value.added === 'boolean' ? value.added : value.isAdded
  if (typeof favorited !== 'boolean' || typeof added !== 'boolean' || typeof value.uploaded !== 'boolean') return null
  return { id: value.id, title: value.title, description: value.description, author: value.author, exams, goals, rating: value.rating, uses: value.uses, createdAt: value.createdAt, shareCode: value.shareCode, wordCount: value.wordCount, favorited, added, uploaded: value.uploaded }
}

function parseMeaning(value: unknown): WordMeaning | null {
  if (!isRecord(value) || !isText(value.pos) || !isText(value.definition) || (value.example !== undefined && !isText(value.example))) return null
  return { pos: value.pos, definition: value.definition, example: value.example }
}

function parseWord(value: unknown): (WordbookItem & { status?: WordStatus }) | null {
  if (!isRecord(value) || !isText(value.id) || !isText(value.word) || !isText(value.phonetic) || !isText(value.addedAt) || !isText(value.source) || !Array.isArray(value.meanings) || (value.audioUrl !== undefined && !isText(value.audioUrl))) return null
  if (
    (value.zhMeaning !== undefined && !isText(value.zhMeaning))
    || (value.zhMeaningSource !== undefined && value.zhMeaningSource !== 'user' && value.zhMeaningSource !== 'dictionary')
  ) return null
  const source: WordSource = value.source as WordSource
  if (!['backend', 'dictionary-api', 'local-ielts', 'user'].includes(source)) return null
  const meanings = value.meanings.map(parseMeaning)
  if (meanings.some((meaning) => meaning === null)) return null
  const status = value.status
  if (status !== undefined && status !== 'new' && status !== 'learning' && status !== 'review' && status !== 'mastered') return null
  return {
    id: value.id,
    word: value.word,
    phonetic: value.phonetic,
    source,
    audioUrl: value.audioUrl,
    addedAt: value.addedAt,
    meanings: meanings as WordMeaning[],
    zhMeaning: value.zhMeaning,
    zhMeaningSource: value.zhMeaningSource,
    status,
  }
}

function parsePlan(value: unknown) {
  if (!isRecord(value)) return null
  const parse = (entry: unknown) => isRecord(entry) && isCount(entry.target) && isCount(entry.completed) ? { target: entry.target, completed: entry.completed } : null
  const newPlan = parse(value.new); const review = parse(value.review); const dictation = parse(value.dictation)
  return newPlan && review && dictation ? { new: newPlan, review, dictation } : null
}

function parseDashboard(value: unknown): StudyDashboard | null {
  if (!isRecord(value) || !isText(value.updatedAt) || !Array.isArray(value.recentActivity) || !Array.isArray(value.calendar) || !isRecord(value.week) || !isCount(value.streakDays)) return null
  const wordbook = parseMyWordbook(value.wordbook); const todayPlan = parsePlan(value.todayPlan)
  if (!wordbook || !todayPlan || !isCount(value.week.newCount) || !isCount(value.week.reviewCount) || !isCount(value.week.dictationCount) || !isCount(value.week.total)) return null
  const recentActivity = value.recentActivity.map((entry) => {
    if (!isRecord(entry) || !isText(entry.id) || !isText(entry.kind) || !isText(entry.wordbookId) || !isText(entry.word) || !isText(entry.occurredAt)) return null
    if (entry.kind !== 'new' && entry.kind !== 'flashcard' && entry.kind !== 'dictation') return null
    if (entry.verdict !== undefined && entry.verdict !== 'know' && entry.verdict !== 'unknown') return null
    if (entry.correct !== undefined && typeof entry.correct !== 'boolean') return null
    return { id: entry.id, kind: entry.kind, wordbookId: entry.wordbookId, word: entry.word, occurredAt: entry.occurredAt, verdict: entry.verdict, correct: entry.correct }
  })
  const calendar = value.calendar.map((entry) => isRecord(entry) && isText(entry.date) && isCount(entry.count) && typeof entry.active === 'boolean' ? { date: entry.date, count: entry.count, active: entry.active } : null)
  if (recentActivity.some((entry) => entry === null) || calendar.some((entry) => entry === null)) return null
  return { wordbook, todayPlan, recentActivity: recentActivity as StudyDashboard['recentActivity'], calendar: calendar as StudyDashboard['calendar'], week: { newCount: value.week.newCount, reviewCount: value.week.reviewCount, dictationCount: value.week.dictationCount, total: value.week.total }, streakDays: value.streakDays, updatedAt: value.updatedAt }
}

function parseImportStatus(value: unknown): ImportDraftStatus | null {
  return value === 'processing' || value === 'ready' || value === 'invalid' || value === 'duplicate' || value === 'unmatched' || value === 'conflict' ? value : null
}

function parseImportDraftEntry(value: unknown): ImportDraftEntry | null {
  if (!isRecord(value) || !isCount(value.line) || !isText(value.word)) return null
  const status = parseImportStatus(value.status) ?? 'ready'
  if (
    (value.id !== undefined && !isText(value.id)) ||
    (value.zhMeaning !== undefined && !isText(value.zhMeaning)) ||
    (value.reason !== undefined && !isText(value.reason)) ||
    (value.conflictWith !== undefined && !isText(value.conflictWith)) ||
    (value.resolution !== undefined && value.resolution !== 'keep' && value.resolution !== 'replace' && value.resolution !== 'merge' && value.resolution !== 'discard')
  ) return null
  return {
    line: value.line,
    word: value.word,
    zhMeaning: value.zhMeaning,
    id: value.id,
    status,
    reason: value.reason,
    conflictWith: value.conflictWith,
    resolution: value.resolution,
  }
}

function parseImportDraft(value: unknown): ImportDraft | null {
  if (!isRecord(value) || !isText(value.id) || !isText(value.title) || !isText(value.description) || !Array.isArray(value.entries)) return null
  const entries = value.entries.map(parseImportDraftEntry)
  if (entries.some((entry) => entry === null)) return null
  const batchIndex = isCount(value.batchIndex) ? value.batchIndex : 0
  const totalBatches = isCount(value.totalBatches) ? value.totalBatches : 1
  if (
    (value.groupId !== undefined && !isText(value.groupId))
    || (value.targetWordbookId !== undefined && !isText(value.targetWordbookId))
    || (value.status !== undefined && value.status !== 'processing' && value.status !== 'pending' && value.status !== 'committed')
    || (value.createdAt !== undefined && !isText(value.createdAt))
    || (value.updatedAt !== undefined && !isText(value.updatedAt))
  ) return null
  return {
    id: value.id,
    groupId: value.groupId,
    title: value.title,
    description: value.description,
    entries: entries as ImportDraftEntry[],
    batchIndex,
    totalBatches,
    targetWordbookId: value.targetWordbookId,
    // Existing local drafts predating background processing are ready to commit.
    status: value.status ?? 'pending',
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  }
}

function buildApiBase(baseUrl: string): URL {
  const url = new URL(baseUrl.trim())
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new TypeError('Backend API base URL must use HTTP or HTTPS.')
  url.search = ''; url.hash = ''
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url
}

/** Optional remote repository for catalog, personal wordbooks, and study data. */
export class WorkspaceApi {
  private readonly baseUrl: URL
  private readonly fetch: FetchLike
  private readonly timeoutMs: number
  private readonly clientId: () => string

  constructor(baseUrl: string, options: WorkspaceApiOptions = {}) {
    this.baseUrl = buildApiBase(baseUrl)
    this.fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init))
    this.timeoutMs = options.timeoutMs ?? 8_000
    this.clientId = options.clientId ?? getStudyClientId
  }

  async listCatalog(query: CatalogQuery = {}) {
    const url = new URL('api/catalog/wordbooks', this.baseUrl)
    if (query.q) url.searchParams.set('q', query.q)
    if (query.exam) url.searchParams.set('exam', query.exam)
    if (query.goal) url.searchParams.set('goal', query.goal)
    if (query.sort) url.searchParams.set('sort', query.sort)
    return this.list(url, parseCatalog, 'catalog list')
  }
  listFavorites() { return this.list(new URL('api/catalog/favorites', this.baseUrl), parseCatalog, 'favorites') }
  listUploads() { return this.list(new URL('api/catalog/uploads/mine', this.baseUrl), parseCatalog, 'uploads') }
  async toggleFavorite(id: string) { return this.json<{ favorited: boolean }>(`api/catalog/wordbooks/${encodeURIComponent(id)}/favorite`, { method: 'POST' }) }
  async addCatalog(id: string) { return this.json<{ wordbook: MyWordbook; created: boolean }>(`api/catalog/wordbooks/${encodeURIComponent(id)}/add`, { method: 'POST' }, (value) => isRecord(value) && typeof value.created === 'boolean' && parseMyWordbook(value.wordbook) ? { wordbook: parseMyWordbook(value.wordbook)!, created: value.created } : null) }
  async upload(input: { title: string; description?: string; exams?: string[]; goals?: string[]; words: WordEntry[] }) { return this.json('api/catalog/uploads', { method: 'POST', body: JSON.stringify(input) }, parseCatalog) }
  uploadWordbook(input: { sourceWordbookId: string; title?: string; description?: string; exams?: string[]; goals?: string[] }) { return this.json('api/catalog/uploads', { method: 'POST', body: JSON.stringify(input) }, parseCatalog) }
  updateCatalogSnapshot(catalogId: string, input: { sourceWordbookId?: string; title?: string; description?: string; exams?: string[]; goals?: string[] }) { return this.json(`api/catalog/wordbooks/${encodeURIComponent(catalogId)}`, { method: 'PATCH', body: JSON.stringify(input) }, parseCatalog) }
  async importShareCode(shareCode: string) { return this.json<{ wordbook: MyWordbook; created: boolean }>('api/catalog/imports', { method: 'POST', body: JSON.stringify({ shareCode }) }, (value) => isRecord(value) && typeof value.created === 'boolean' && parseMyWordbook(value.wordbook) ? { wordbook: parseMyWordbook(value.wordbook)!, created: value.created } : null) }
  listMyWordbooks(trash = false) { const url = new URL('api/my/wordbooks', this.baseUrl); if (trash) url.searchParams.set('view', 'trash'); return this.list(url, parseMyWordbook, 'wordbook list') }
  createMyWordbook(input: { title: string; description?: string; words?: WordEntry[] }) { return this.json('api/my/wordbooks', { method: 'POST', body: JSON.stringify(input) }, parseMyWordbook) }
  createImportDraft(input: { title: string; description?: string; lines: ImportDraftLine[] }) {
    return this.json('api/my/import-drafts', { method: 'POST', body: JSON.stringify(input) }, parseImportDraft)
  }
  listImportDrafts() { return this.list(new URL('api/my/import-drafts', this.baseUrl), parseImportDraft, 'import drafts') }
  getImportDraft(id: string) { return this.json(`api/my/import-drafts/${encodeURIComponent(id)}`, {}, parseImportDraft) }
  processImportDraft(id: string) { return this.json(`api/my/import-drafts/${encodeURIComponent(id)}/process`, { method: 'POST' }, parseImportDraft) }
  deleteImportDraft(id: string) { return this.empty(`api/my/import-drafts/${encodeURIComponent(id)}`, { method: 'DELETE' }) }
  commitImportDraft(id: string, resolutions: Record<string, ImportConflictResolution> = {}) { return this.json(`api/my/import-drafts/${encodeURIComponent(id)}/commit`, { method: 'POST', body: JSON.stringify({ resolutions }) }, parseMyWordbook) }
  deleteMyWordbook(id: string) { return this.empty(`api/my/wordbooks/${encodeURIComponent(id)}`, { method: 'DELETE' }) }
  restoreMyWordbook(id: string) { return this.json(`api/my/wordbooks/${encodeURIComponent(id)}/restore`, { method: 'POST' }, parseMyWordbook) }
  listWords(id: string, status?: WordStatus) { const url = new URL(`api/my/wordbooks/${encodeURIComponent(id)}/words`, this.baseUrl); if (status) url.searchParams.set('status', status); return this.list(url, parseWord, 'word list') }
  updateWord(wordbookId: string, wordId: string, input: UpdateWordInput) { return this.json(`api/my/wordbooks/${encodeURIComponent(wordbookId)}/words/${encodeURIComponent(wordId)}`, { method: 'PATCH', body: JSON.stringify(input) }, parseWord) }
  getDashboard(id: string) { return this.json(`api/study/dashboard/${encodeURIComponent(id)}`, {}, parseDashboard) }
  recordStudyEvent(event: LearningEvent) { return this.json('api/study/events', { method: 'POST', body: JSON.stringify(event) }, (value) => value) }

  private async list<T>(url: URL, parser: (value: unknown) => T | null, label: string): Promise<T[]> {
    const payload = await this.request(url)
    if (!Array.isArray(payload)) throw new Error(`${label} response is invalid.`)
    const items = payload.map(parser)
    if (items.some((item) => item === null)) throw new Error(`${label} response is invalid.`)
    return items as T[]
  }
  private async json<T = unknown>(
    path: string,
    init: RequestInit,
    parser: (value: unknown) => T | null = (value) => value as T,
    timeoutMs = this.timeoutMs,
  ): Promise<T> {
    const payload = await this.request(new URL(path, this.baseUrl), init, timeoutMs)
    const parsed = parser(payload)
    if (parsed === null) throw new Error('Backend response is invalid.')
    return parsed
  }
  private async empty(path: string, init: RequestInit) {
    const response = await this.fetch(new URL(path, this.baseUrl), this.requestInit(init))
    if (!response.ok) throw new Error(`Backend request failed (${response.status}).`)
  }
  private async request(url: URL, init: RequestInit = {}, timeoutMs = this.timeoutMs): Promise<unknown> {
    const response = await this.fetch(url, this.requestInit(init, timeoutMs))
    if (!response.ok) throw new Error(`Backend request failed (${response.status}).`)
    try { return await response.json() } catch { throw new Error('Backend response is not valid JSON.') }
  }
  private requestInit(init: RequestInit, timeoutMs = this.timeoutMs) {
    return { ...init, headers: { 'X-Vocab-Client-Id': this.clientId(), 'Content-Type': 'application/json', ...init.headers }, signal: AbortSignal.timeout(timeoutMs) }
  }
}

const apiBase = import.meta.env.VITE_API_BASE?.trim()
const workspaceApi = apiBase ? new WorkspaceApi(apiBase) : null
export function hasWorkspaceApi() { return workspaceApi !== null }
export function getWorkspaceApi() { return workspaceApi }
