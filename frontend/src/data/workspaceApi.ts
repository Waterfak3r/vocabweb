import type { WordbookItem, WordEntry, WordMeaning, WordSource } from '../domain/types'
import { resolveApiBase } from './resolveApiBase'
import { getStudyClientId } from './studyApi'

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export type CatalogSort = 'recommended' | 'hot' | 'newest' | 'rating'
/** 公开=进广场列表；邀请码=仅凭分享码导入；私密=仅自己可见。 */
export type CatalogVisibility = 'public' | 'unlisted' | 'private'
export type AuthCapability = 'site.settings.write' | 'messages.moderate' | 'messages.contact.read'
export type AuthUser = { username: string; clientId: string; role: 'user' | 'admin'; capabilities: AuthCapability[] }
export type CatalogExam = 'IELTS' | 'TOEFL' | 'GRE' | '高考' | '四级' | '六级' | '四六级' | '考研'
export type LearningGoal = '写作' | '阅读' | '听力' | '口语'
export type CatalogQuery = { q?: string; exam?: CatalogExam; goal?: LearningGoal; sort?: CatalogSort }
export type WordStatus = 'new' | 'learning' | 'review' | 'mastered'
/** 熟练度档位：0 未学习 / 1 初识 / 2 熟悉 / 3 掌握 / 4 精通 */
export type WordLevel = 0 | 1 | 2 | 3 | 4
export type RecognitionStreak = 0 | 1 | 2
export type LevelCounts = { l0: number; l1: number; l2: number; l3: number; l4: number }

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
  favoriteCount: number
  favorited: boolean
  added: boolean
  uploaded: boolean
  /** Present on servers with community accounts; absent values render as legacy public entries. */
  visibility?: CatalogVisibility
  /** Owner upload feeds may expose this so snapshot updates can select the exact source wordbook. */
  sourceWordbookId?: string
}
export type CatalogDetail = CatalogWordbook & { words: WordEntry[] }

export type WordbookProgress = {
  mastered: number
  learning: number
  review: number
  unstudied: number
  percent: number
  /** Per-level tallies; derived from the legacy buckets when the server omits them. */
  levels: LevelCounts
}

export type MyWordbook = {
  id: string
  title: string
  description: string
  category?: string
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
  recentActivity: Array<{ id: string; kind: 'new' | 'flashcard' | 'dictation' | 'mark'; wordbookId: string; word: string; occurredAt: string; verdict?: 'know' | 'unknown'; correct?: boolean; level?: WordLevel; levelAfter?: WordLevel }>
  calendar: Array<{ date: string; count: number; active: boolean }>
  week: { newCount: number; reviewCount: number; dictationCount: number; total: number }
  streakDays: number
  /** L3 words whose 7-day window has passed — dictation now promotes them to L4. */
  finalCheckDue?: number
  updatedAt: string
}

export type LearningEvent =
  | { kind: 'new'; wordbookId: string; word: string; verdict?: 'know' | 'unknown' }
  | { kind: 'flashcard'; wordbookId: string; word: string; verdict: 'know' | 'unknown' }
  | { kind: 'dictation'; wordbookId: string; word: string; correct: boolean }
  /** Manual proficiency override, e.g. 标熟 sets level 4. */
  | { kind: 'mark'; wordbookId: string; word: string; level: WordLevel }

export type ImportDraftLine = {
  line: number
  word: string
  pos?: string
  enDefinition?: string
  zhMeaning?: string
  example?: string
}

export type ImportDraftStatus = 'processing' | 'ready' | 'invalid' | 'duplicate' | 'unmatched' | 'conflict'
export type ImportConflictResolution = 'keep' | 'replace' | 'merge' | 'discard'

export type ImportDraftEntry = ImportDraftLine & {
  id?: string
  status: ImportDraftStatus
  reason?: string
  conflictWith?: string
  resolution?: ImportConflictResolution
  entry?: WordEntry
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

export type BatchWordAction = 'refresh-meanings' | 'delete' | 'mark-mastered'
export type BatchWordResult = {
  action: BatchWordAction
  succeededIds: string[]
  failed: Array<{ wordId: string; code: 'WORD_NOT_FOUND' | 'DICTIONARY_UNAVAILABLE' }>
}

type WorkspaceApiOptions = { fetch?: FetchLike; timeoutMs?: number; clientId?: () => string }

export class WorkspaceApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code?: string,
    message = `Backend request failed (${status}).`,
  ) {
    super(message)
    this.name = 'WorkspaceApiError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isText(value: unknown): value is string { return typeof value === 'string' }
function isCount(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0 }
function textArray(value: unknown): string[] | null { return Array.isArray(value) && value.every(isText) ? value : null }

async function responseError(response: Response): Promise<WorkspaceApiError> {
  try {
    const payload: unknown = await response.json()
    if (isRecord(payload) && isRecord(payload.error)) {
      const code = isText(payload.error.code) ? payload.error.code : undefined
      const message = isText(payload.error.message) ? payload.error.message : undefined
      return new WorkspaceApiError(response.status, code, message)
    }
  } catch {
    // Fall back to a stable status-only error when the body is empty or malformed.
  }
  return new WorkspaceApiError(response.status)
}

function parseLevelCounts(value: unknown): LevelCounts | null {
  if (!isRecord(value) || !isCount(value.l0) || !isCount(value.l1) || !isCount(value.l2) || !isCount(value.l3) || !isCount(value.l4)) return null
  return { l0: value.l0, l1: value.l1, l2: value.l2, l3: value.l3, l4: value.l4 }
}

function parseProgress(value: unknown): WordbookProgress | null {
  if (!isRecord(value) || !isCount(value.mastered) || !isCount(value.learning) || !isCount(value.review) || !isCount(value.unstudied) || !isCount(value.percent)) return null
  const levels = parseLevelCounts(value.levels)
    // Older payloads carry only the legacy buckets; approximate the ladder from them.
    ?? { l0: value.unstudied, l1: value.learning, l2: value.review, l3: value.mastered, l4: 0 }
  return { mastered: value.mastered, learning: value.learning, review: value.review, unstudied: value.unstudied, percent: value.percent, levels }
}

function parseMyWordbook(value: unknown): MyWordbook | null {
  if (!isRecord(value) || !isText(value.id) || !isText(value.title) || !isText(value.description) || !isText(value.createdAt) || !isText(value.updatedAt) || !isCount(value.wordCount)) return null
  const progress = parseProgress(value.progress)
  if (!progress || (value.sourceCatalogId !== undefined && !isText(value.sourceCatalogId)) || (value.category !== undefined && !isText(value.category))) return null
  return { id: value.id, title: value.title, description: value.description, category: value.category, sourceCatalogId: value.sourceCatalogId, createdAt: value.createdAt, updatedAt: value.updatedAt, wordCount: value.wordCount, progress }
}

function parseCatalog(value: unknown): CatalogWordbook | null {
  if (!isRecord(value) || !isText(value.id) || !isText(value.title) || !isText(value.description) || !isText(value.author) || !isCount(value.rating) || !isCount(value.uses) || !isText(value.createdAt) || !isText(value.shareCode) || !isCount(value.wordCount)) return null
  const exams = textArray(value.exams)
  const goals = textArray(value.goals)
  if (!exams || !goals) return null
  const favorited = typeof value.favorited === 'boolean' ? value.favorited : value.isFavorite
  const added = typeof value.added === 'boolean' ? value.added : value.isAdded
  if (typeof favorited !== 'boolean' || typeof added !== 'boolean' || typeof value.uploaded !== 'boolean') return null
  if (value.visibility !== undefined && value.visibility !== 'public' && value.visibility !== 'unlisted' && value.visibility !== 'private') return null
  if (value.sourceWordbookId !== undefined && !isText(value.sourceWordbookId)) return null
  const favoriteCount = isCount(value.favoriteCount) ? value.favoriteCount : 0
  return { id: value.id, title: value.title, description: value.description, author: value.author, exams, goals, rating: value.rating, uses: value.uses, createdAt: value.createdAt, shareCode: value.shareCode, wordCount: value.wordCount, favoriteCount, favorited, added, uploaded: value.uploaded, visibility: value.visibility, sourceWordbookId: value.sourceWordbookId }
}

function parseAuthUser(value: unknown): AuthUser | null {
  if (!isRecord(value) || !isText(value.username) || !isText(value.clientId)) return null
  if (value.role !== 'user' && value.role !== 'admin') return null
  if (!Array.isArray(value.capabilities)) return null
  const allowed: AuthCapability[] = ['site.settings.write', 'messages.moderate', 'messages.contact.read']
  if (!value.capabilities.every((item): item is AuthCapability => typeof item === 'string' && allowed.includes(item as AuthCapability))) return null
  return { username: value.username, clientId: value.clientId, role: value.role, capabilities: [...value.capabilities] }
}

function parseMeaning(value: unknown): WordMeaning | null {
  if (!isRecord(value) || !isText(value.pos) || !isText(value.definition) || (value.example !== undefined && !isText(value.example))) return null
  const sourceId = value.sourceId === 'open_english_wordnet' || value.sourceId === 'wiktionary' || value.sourceId === 'wiktapi'
    ? value.sourceId
    : undefined
  return { pos: value.pos, definition: value.definition, example: value.example, sourceId }
}

function parseCatalogEntry(value: unknown): WordEntry | null {
  if (!isRecord(value) || !isText(value.word) || !isText(value.phonetic) || !isText(value.source) || !Array.isArray(value.meanings)) return null
  const meanings = value.meanings.map(parseMeaning)
  if (meanings.some((meaning) => meaning === null)) return null
  if (value.audioUrl !== undefined && !isText(value.audioUrl)) return null
  if (value.zhMeaning !== undefined && !isText(value.zhMeaning)) return null
  if (value.zhMeaningSource !== undefined && value.zhMeaningSource !== 'user' && value.zhMeaningSource !== 'dictionary') return null
  if (!['backend', 'dictionary-api', 'local-ielts', 'user'].includes(value.source)) return null
  return {
    word: value.word, phonetic: value.phonetic, source: value.source as WordSource,
    meanings: meanings as WordMeaning[], audioUrl: value.audioUrl,
    zhMeaning: value.zhMeaning, zhMeaningSource: value.zhMeaningSource,
  }
}

function parseCatalogDetail(value: unknown): CatalogDetail | null {
  const card = parseCatalog(value)
  if (!card || !isRecord(value) || !Array.isArray(value.words)) return null
  const words = value.words.map(parseCatalogEntry)
  return words.some((word) => word === null) ? null : { ...card, words: words as WordEntry[] }
}

function isWordLevel(value: unknown): value is WordLevel {
  return value === 0 || value === 1 || value === 2 || value === 3 || value === 4
}

function parseWord(value: unknown): (WordbookItem & { status?: WordStatus; level?: WordLevel; levelReachedAt?: string; lastStudiedAt?: string; recognitionStreak?: RecognitionStreak }) | null {
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
  if (value.level !== undefined && !isWordLevel(value.level)) return null
  if (value.levelReachedAt !== undefined && !isText(value.levelReachedAt)) return null
  if (value.lastStudiedAt !== undefined && !isText(value.lastStudiedAt)) return null
  if (value.recognitionStreak !== undefined && value.recognitionStreak !== 0 && value.recognitionStreak !== 1 && value.recognitionStreak !== 2) return null
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
    level: value.level,
    levelReachedAt: value.levelReachedAt,
    lastStudiedAt: value.lastStudiedAt,
    recognitionStreak: value.recognitionStreak as RecognitionStreak | undefined,
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
    if (entry.kind !== 'new' && entry.kind !== 'flashcard' && entry.kind !== 'dictation' && entry.kind !== 'mark') return null
    if (entry.verdict !== undefined && entry.verdict !== 'know' && entry.verdict !== 'unknown') return null
    if (entry.correct !== undefined && typeof entry.correct !== 'boolean') return null
    if (entry.level !== undefined && !isWordLevel(entry.level)) return null
    if (entry.levelAfter !== undefined && !isWordLevel(entry.levelAfter)) return null
    return { id: entry.id, kind: entry.kind, wordbookId: entry.wordbookId, word: entry.word, occurredAt: entry.occurredAt, verdict: entry.verdict, correct: entry.correct, level: entry.level, levelAfter: entry.levelAfter }
  })
  const calendar = value.calendar.map((entry) => isRecord(entry) && isText(entry.date) && isCount(entry.count) && typeof entry.active === 'boolean' ? { date: entry.date, count: entry.count, active: entry.active } : null)
  if (recentActivity.some((entry) => entry === null) || calendar.some((entry) => entry === null)) return null
  if (value.finalCheckDue !== undefined && !isCount(value.finalCheckDue)) return null
  return { wordbook, todayPlan, recentActivity: recentActivity as StudyDashboard['recentActivity'], calendar: calendar as StudyDashboard['calendar'], week: { newCount: value.week.newCount, reviewCount: value.week.reviewCount, dictationCount: value.week.dictationCount, total: value.week.total }, streakDays: value.streakDays, ...(value.finalCheckDue !== undefined ? { finalCheckDue: value.finalCheckDue } : {}), updatedAt: value.updatedAt }
}

function parseImportStatus(value: unknown): ImportDraftStatus | null {
  return value === 'processing' || value === 'ready' || value === 'invalid' || value === 'duplicate' || value === 'unmatched' || value === 'conflict' ? value : null
}

function parseImportDraftEntry(value: unknown): ImportDraftEntry | null {
  if (!isRecord(value) || !isCount(value.line) || !isText(value.word)) return null
  const status = parseImportStatus(value.status) ?? 'ready'
  if (
    (value.id !== undefined && !isText(value.id)) ||
    (value.pos !== undefined && !isText(value.pos)) ||
    (value.enDefinition !== undefined && !isText(value.enDefinition)) ||
    (value.zhMeaning !== undefined && !isText(value.zhMeaning)) ||
    (value.example !== undefined && !isText(value.example)) ||
    (value.entry !== undefined && parseCatalogEntry(value.entry) === null) ||
    (value.reason !== undefined && !isText(value.reason)) ||
    (value.conflictWith !== undefined && !isText(value.conflictWith)) ||
    (value.resolution !== undefined && value.resolution !== 'keep' && value.resolution !== 'replace' && value.resolution !== 'merge' && value.resolution !== 'discard')
  ) return null
  return {
    line: value.line,
    word: value.word,
    pos: value.pos,
    enDefinition: value.enDefinition,
    zhMeaning: value.zhMeaning,
    example: value.example,
    id: value.id,
    status,
    reason: value.reason,
    conflictWith: value.conflictWith,
    resolution: value.resolution,
    entry: value.entry === undefined ? undefined : parseCatalogEntry(value.entry) ?? undefined,
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

/** Optional remote repository for catalog, personal wordbooks, and study data. */
export class WorkspaceApi {
  private readonly baseUrl: URL
  private readonly fetch: FetchLike
  private readonly timeoutMs: number
  private readonly clientId: () => string

  constructor(baseUrl: string, options: WorkspaceApiOptions = {}) {
    this.baseUrl = resolveApiBase(baseUrl)
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
  getCatalog(id: string) { return this.json(`api/catalog/wordbooks/${encodeURIComponent(id)}`, {}, parseCatalogDetail) }
  async toggleFavorite(id: string) { return this.json<{ favorited: boolean; favoriteCount: number }>(`api/catalog/wordbooks/${encodeURIComponent(id)}/favorite`, { method: 'POST' }, (value) => isRecord(value) && typeof value.favorited === 'boolean' && isCount(value.favoriteCount) ? { favorited: value.favorited, favoriteCount: value.favoriteCount } : null) }
  async addCatalog(id: string) { return this.json<{ wordbook: MyWordbook; created: boolean }>(`api/catalog/wordbooks/${encodeURIComponent(id)}/add`, { method: 'POST' }, (value) => isRecord(value) && typeof value.created === 'boolean' && parseMyWordbook(value.wordbook) ? { wordbook: parseMyWordbook(value.wordbook)!, created: value.created } : null) }
  async upload(input: { title: string; description?: string; exams?: string[]; goals?: string[]; words: WordEntry[]; visibility?: CatalogVisibility }) { return this.json('api/catalog/uploads', { method: 'POST', body: JSON.stringify(input) }, parseCatalog) }
  uploadWordbook(input: { sourceWordbookId: string; title?: string; description?: string; exams?: string[]; goals?: string[]; visibility?: CatalogVisibility }) { return this.json('api/catalog/uploads', { method: 'POST', body: JSON.stringify(input) }, parseCatalog) }
  updateCatalogSnapshot(catalogId: string, input: { sourceWordbookId?: string; title?: string; description?: string; exams?: string[]; goals?: string[]; visibility?: CatalogVisibility }) { return this.json(`api/catalog/wordbooks/${encodeURIComponent(catalogId)}`, { method: 'PATCH', body: JSON.stringify(input) }, parseCatalog) }
  async importShareCode(shareCode: string) { return this.json<{ wordbook: MyWordbook; created: boolean }>('api/catalog/imports', { method: 'POST', body: JSON.stringify({ shareCode }) }, (value) => isRecord(value) && typeof value.created === 'boolean' && parseMyWordbook(value.wordbook) ? { wordbook: parseMyWordbook(value.wordbook)!, created: value.created } : null) }
  listMyWordbooks(trash = false) { const url = new URL('api/my/wordbooks', this.baseUrl); if (trash) url.searchParams.set('view', 'trash'); return this.list(url, parseMyWordbook, 'wordbook list') }
  createMyWordbook(input: { title: string; description?: string; category?: string; words?: WordEntry[] }) { return this.json('api/my/wordbooks', { method: 'POST', body: JSON.stringify(input) }, parseMyWordbook) }
  updateMyWordbook(id: string, input: { category: string | null }) { return this.json(`api/my/wordbooks/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) }, parseMyWordbook) }
  createImportDraft(input: { title: string; description?: string; targetWordbookId?: string; lines: ImportDraftLine[] }) {
    return this.json('api/my/import-drafts', { method: 'POST', body: JSON.stringify(input) }, parseImportDraft)
  }
  listImportDrafts() { return this.list(new URL('api/my/import-drafts', this.baseUrl), parseImportDraft, 'import drafts') }
  getImportDraft(id: string) { return this.json(`api/my/import-drafts/${encodeURIComponent(id)}`, {}, parseImportDraft) }
  processImportDraft(id: string) { return this.json(`api/my/import-drafts/${encodeURIComponent(id)}/process`, { method: 'POST' }, parseImportDraft) }
  deleteImportDraft(id: string) { return this.empty(`api/my/import-drafts/${encodeURIComponent(id)}`, { method: 'DELETE' }) }
  commitImportDraft(id: string, resolutions: Record<string, ImportConflictResolution> = {}, mode: 'append' | 'overwrite' = 'append') { return this.json(`api/my/import-drafts/${encodeURIComponent(id)}/commit`, { method: 'POST', body: JSON.stringify({ mode, resolutions }) }, parseMyWordbook) }
  deleteMyWordbook(id: string) { return this.empty(`api/my/wordbooks/${encodeURIComponent(id)}`, { method: 'DELETE' }) }
  restoreMyWordbook(id: string) { return this.json(`api/my/wordbooks/${encodeURIComponent(id)}/restore`, { method: 'POST' }, parseMyWordbook) }
  listWords(id: string, status?: WordStatus) { const url = new URL(`api/my/wordbooks/${encodeURIComponent(id)}/words`, this.baseUrl); if (status) url.searchParams.set('status', status); return this.list(url, parseWord, 'word list') }
  updateWord(wordbookId: string, wordId: string, input: UpdateWordInput) { return this.json(`api/my/wordbooks/${encodeURIComponent(wordbookId)}/words/${encodeURIComponent(wordId)}`, { method: 'PATCH', body: JSON.stringify(input) }, parseWord) }
  batchWords(wordbookId: string, action: BatchWordAction, wordIds: string[]) {
    return this.json(
      `api/my/wordbooks/${encodeURIComponent(wordbookId)}/words/batch`,
      { method: 'POST', body: JSON.stringify({ action, wordIds }) },
      (value): BatchWordResult | null => {
        if (!isRecord(value) || value.action !== action || !Array.isArray(value.succeededIds) || !value.succeededIds.every(isText) || !Array.isArray(value.failed)) return null
        const failed = value.failed.map((item) => isRecord(item) && isText(item.wordId) && (item.code === 'WORD_NOT_FOUND' || item.code === 'DICTIONARY_UNAVAILABLE')
          ? { wordId: item.wordId, code: item.code }
          : null)
        return failed.some((item) => item === null)
          ? null
          : { action, succeededIds: value.succeededIds, failed: failed as BatchWordResult['failed'] }
      },
    )
  }
  getDashboard(id: string) { return this.json(`api/study/dashboard/${encodeURIComponent(id)}`, {}, parseDashboard) }
  recordStudyEvent(event: LearningEvent) { return this.json('api/study/events', { method: 'POST', body: JSON.stringify(event) }, (value) => value) }
  /** Adds one word to a wordbook; the backend supplements dictionary data. 200 means it was already there. */
  async addWordToWordbook(wordbookId: string, input: { word: string; zhMeaning?: string }) {
    const url = new URL(`api/my/wordbooks/${encodeURIComponent(wordbookId)}/words`, this.baseUrl)
    const response = await this.fetch(url, this.requestInit({ method: 'POST', body: JSON.stringify(input) }))
    if (!response.ok) throw await responseError(response)
    let payload: unknown
    try { payload = await response.json() } catch { throw new Error('Backend response is not valid JSON.') }
    const word = parseWord(isRecord(payload) ? payload.word : undefined)
    if (!word) throw new Error('Backend response is invalid.')
    return { word, duplicate: response.status === 200 }
  }
  /** Permanently deletes a trashed wordbook and its study events. */
  purgeMyWordbook(id: string) { return this.empty(`api/my/wordbooks/${encodeURIComponent(id)}/purge`, { method: 'DELETE' }) }
  /** Removes one of the client's own catalog uploads from the marketplace. */
  deleteCatalogUpload(id: string) { return this.empty(`api/catalog/wordbooks/${encodeURIComponent(id)}`, { method: 'DELETE' }) }

  /* ── Accounts (session cookie; the server binds the account's data clientId) ── */
  register(username: string, password: string) { return this.json('api/auth/register', { method: 'POST', body: JSON.stringify({ username, password }) }, parseAuthUser) }
  login(username: string, password: string) { return this.json('api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }, parseAuthUser) }
  logout() { return this.empty('api/auth/logout', { method: 'POST' }) }
  async exportAccount(): Promise<unknown> {
    const response = await this.fetch(new URL('api/account/export', this.baseUrl), this.requestInit({}))
    if (!response.ok) throw await responseError(response)
    try { return await response.json() } catch { throw new Error('Backend response is not valid JSON.') }
  }
  deleteAccount(password: string) {
    return this.empty('api/account', { method: 'DELETE', body: JSON.stringify({ password }) })
  }
  /** Returns the signed-in user, or null when the session is absent/expired. */
  async me(): Promise<AuthUser | null> {
    const response = await this.fetch(new URL('api/auth/me', this.baseUrl), this.requestInit({}))
    if (response.status === 401) return null
    if (!response.ok) throw await responseError(response)
    let payload: unknown
    try { payload = await response.json() } catch { throw new Error('Backend response is not valid JSON.') }
    const user = parseAuthUser(payload)
    if (!user) throw new Error('Backend response is invalid.')
    return user
  }

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
    if (!response.ok) throw await responseError(response)
  }
  private async request(url: URL, init: RequestInit = {}, timeoutMs = this.timeoutMs): Promise<unknown> {
    const response = await this.fetch(url, this.requestInit(init, timeoutMs))
    if (!response.ok) throw await responseError(response)
    try { return await response.json() } catch { throw new Error('Backend response is not valid JSON.') }
  }
  private requestInit(init: RequestInit, timeoutMs = this.timeoutMs): RequestInit {
    // credentials: 'include' carries the session cookie in dev too, where the Vite
    // origin differs from the backend origin (same-origin prod is unaffected).
    return { ...init, credentials: 'include', headers: { 'X-Vocab-Client-Id': this.clientId(), 'Content-Type': 'application/json', ...init.headers }, signal: AbortSignal.timeout(timeoutMs) }
  }
}

const apiBase = import.meta.env.VITE_API_BASE?.trim()
const workspaceApi = apiBase ? new WorkspaceApi(apiBase) : null
export function hasWorkspaceApi() { return workspaceApi !== null }
export function getWorkspaceApi() { return workspaceApi }
