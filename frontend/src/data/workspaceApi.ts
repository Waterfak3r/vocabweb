import type { WordbookItem, WordEntry, WordMeaning, WordSource } from '../domain/types'
import { resolveApiBase } from './resolveApiBase'
import {
  DEFAULT_REVIEW_SCHEDULE,
  parseReviewSchedule,
  type ReviewSchedule,
  type WordLevel,
  type WordStatus,
} from './reviewSchedule'
import { getStudyClientId } from './studyApi'
import {
  DEFAULT_STUDY_SHORTCUTS,
  normalizeShortcutKey,
  type StudyShortcutAction,
  type StudyShortcutPreferences,
} from './studyShortcuts'
import type {
  DictationDisplayPreferences,
  FlashcardDisplayPreferences,
  MeaningPreference,
  StudyDisplayPreferences,
  StudyExerciseType,
  WordbookStudyPreferences,
} from './studyPreferences'
import type { PronunciationPreferences } from './pronunciationPreferences'
import { invalidateMarketplaceCatalogCache } from './marketplaceCatalogCache'
import { notifyImportDraftsChanged } from './importDraftStatus'

export type { ReviewSchedule, WordLevel, WordStatus } from './reviewSchedule'

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

async function invalidateMarketplaceAfter<T>(operation: Promise<T>): Promise<T> {
  const result = await operation
  invalidateMarketplaceCatalogCache()
  return result
}

async function notifyImportDraftsAfter<T>(operation: Promise<T>): Promise<T> {
  const result = await operation
  notifyImportDraftsChanged()
  return result
}

export type CatalogSort = 'recommended' | 'hot' | 'newest' | 'rating'
/** 公开=进广场列表；邀请码=仅凭分享码导入；私密=仅自己可见。 */
export type CatalogVisibility = 'public' | 'unlisted' | 'private'
export type AuthCapability = 'site.settings.write' | 'messages.moderate' | 'messages.contact.read'
export type AuthUser = {
  username: string
  clientId: string
  role: 'user' | 'admin'
  /** Optional only for a short rolling-deploy window against an older backend. */
  createdAt?: string
  /** `undefined` means an older backend; `null` means this account has no uploaded avatar. */
  avatarUrl?: string | null
  capabilities: AuthCapability[]
}
export type CatalogExam = 'IELTS' | 'TOEFL' | 'GRE' | '高考' | '四级' | '六级' | '四六级' | '考研'
export type LearningGoal = '写作' | '阅读' | '听力' | '口语'
export type CatalogQuery = { q?: string; exam?: CatalogExam; goal?: LearningGoal; sort?: CatalogSort }
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
  updatedAt?: string
  headRevisionId?: string
  shareCode: string
  wordCount: number
  favoriteCount: number
  favorited: boolean
  added: boolean
  uploaded: boolean
  collaborationEnabled?: boolean
  openContributionCount?: number
  latestRevision?: CatalogRevisionSummary
  /** Present on servers with community accounts; absent values render as legacy public entries. */
  visibility?: CatalogVisibility
  /** Owner upload feeds may expose this so snapshot updates can select the exact source wordbook. */
  sourceWordbookId?: string
}
export type CatalogDetail = CatalogWordbook & { words: WordEntry[] }
export type CatalogWordsQuery = { page?: number; pageSize?: number; q?: string }
export type CatalogWordsPage = {
  items: WordEntry[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export type MyWordbookWord = WordbookItem & {
  status?: WordStatus
  level?: WordLevel
  levelReachedAt?: string
  lastStudiedAt?: string
  reviewIntervalDays?: number
  nextReviewAt?: string
  recognitionStreak?: RecognitionStreak
}
export type LearningQueueItem = MyWordbookWord & {
  status: WordStatus
  level: WordLevel
  reviewIntervalDays: number
  recognitionStreak: RecognitionStreak
}
export type MyWordbookWordsQuery = { page?: number; pageSize?: number; q?: string; level?: WordLevel }
export type MyWordbookWordsPage = {
  items: MyWordbookWord[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  totalWordCount: number
  levelCounts: LevelCounts
}

export type CatalogRevisionKind = 'initial' | 'update' | 'merge' | 'revert'
export type CatalogContributionStatus = 'open' | 'merged' | 'closed'
export type CatalogDiffStats = {
  additions: number
  deletions: number
  updates: number
  changedWords: number
}
export type CatalogWordChange =
  | { kind: 'add'; key: string; after: WordEntry }
  | { kind: 'delete'; key: string; before: WordEntry }
  | { kind: 'update'; key: string; before: WordEntry; after: WordEntry }
export type CatalogRevisionSummary = {
  id: string
  kind: CatalogRevisionKind
  message: string
  author: string
  committer?: string
  createdAt: string
  stats: CatalogDiffStats
  contributionId?: string
  revertsRevisionId?: string
}
export type CatalogRevision = CatalogRevisionSummary & {
  catalogId: string
  catalogTitle: string
  parentRevisionId?: string
  changes: CatalogWordChange[]
  canRevert: boolean
}
export type CatalogContribution = {
  id: string
  catalogId: string
  catalogTitle: string
  contributor: string
  baseRevisionId: string
  submittedHeadRevisionId: string
  title: string
  description: string
  status: CatalogContributionStatus
  changes: CatalogWordChange[]
  stats: CatalogDiffStats
  createdAt: string
  updatedAt: string
  handledAt?: string
  handledBy?: string
  resolutionNote?: string
  mergedRevisionId?: string
  canMerge: boolean
  canClose: boolean
}
export type CatalogConflict = {
  key: string
  reason: 'overlapping-change' | 'source-diverged'
  base?: WordEntry
  current?: WordEntry
  proposed?: WordEntry
}
export type ContributionPreview = {
  catalogId: string
  catalogTitle: string
  sourceWordbookId: string
  baseRevisionId: string
  headRevisionId: string
  expectedSourceUpdatedAt: string
  expectedHeadRevisionId: string
  legacyBaseline: boolean
  changes: CatalogWordChange[]
  stats: CatalogDiffStats
  overlaps: CatalogConflict[]
}
export type RevertPreview = {
  catalogId: string
  revisionId: string
  headRevisionId: string
  changes: CatalogWordChange[]
  stats: CatalogDiffStats
  conflicts: CatalogConflict[]
  alreadyReverted: boolean
}
export type CursorPage<T> = { items: T[]; nextCursor?: string }
export type ContributionInboxPage = CursorPage<CatalogContribution> & { openCount: number }

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
  sourceRevisionId?: string
  createdAt: string
  updatedAt: string
  wordCount: number
  progress: WordbookProgress
  reviewSchedule: ReviewSchedule
  /** Absent only until an older browser's local settings have been seeded remotely. */
  studyPreferences?: WordbookStudyPreferences
}

export type SyncedStudySettings = {
  shortcuts: StudyShortcutPreferences
  pronunciation: PronunciationPreferences
  updatedAt: string
}

export type StudySettingsSnapshot = {
  settings: SyncedStudySettings | null
}

export type StudyDashboard = {
  wordbook: MyWordbook
  todayPlan: {
    new: { target: number; completed: number }
    review: { target: number; completed: number }
    dictation: { target: number; completed: number }
  }
  recentActivity: Array<{ id: string; kind: 'new' | 'flashcard' | 'dictation' | 'mark'; wordbookId: string; word: string; occurredAt: string; verdict?: LearningVerdict; correct?: boolean; level?: WordLevel; levelAfter?: WordLevel }>
  calendar: Array<{ date: string; count: number; active: boolean }>
  week: { newCount: number; reviewCount: number; dictationCount: number; total: number }
  streakDays: number
  reviewBreakdown?: { protected: number; regular: number; backlog: number; scheduled: number }
  activeRounds?: Array<{ id: string; mode: StudyRoundMode; scope: StudyRoundScope; remainingWords: number; updatedAt: string }>
  /** Due L3 words whose next successful dictation can complete the final proficiency step. */
  finalCheckDue?: number
  updatedAt: string
}

export type AccountStudyProfileActivity = {
  id: string
  kind: 'new' | 'flashcard' | 'dictation' | 'mark'
  wordbookId: string
  wordbookTitle: string
  word: string
  occurredAt: string
  verdict?: LearningVerdict
  correct?: boolean
  level?: WordLevel
  levelAfter?: WordLevel
}

export type AccountStudyProfile = {
  metrics: {
    wordbookCount: number
    wordCount: number
    learnedWordCount: number
    currentStreak: number
    longestStreak: number
  }
  activityWindow: { startDate: string; endDate: string; days: 90 }
  activity: Array<{ date: string; count: number }>
  recentActivity: AccountStudyProfileActivity[]
}

export type LearningVerdict = 'know' | 'vague' | 'unknown'
export type LearningEvent =
  | { kind: 'new'; wordbookId: string; word: string; verdict?: LearningVerdict }
  | { kind: 'flashcard'; wordbookId: string; word: string; verdict: LearningVerdict }
  | { kind: 'dictation'; wordbookId: string; word: string; correct: boolean }
  /** Manual proficiency override, e.g. 标熟 sets level 4. */
  | { kind: 'mark'; wordbookId: string; word: string; level: WordLevel }

export type StudyRoundMode = 'new' | 'review'
export type StudyRoundScope = 'standard' | 'backlog' | 'ahead'
export type StudyRoundTask = {
  id: string
  wordId: string
  exercise: StudyExerciseType
}
export type StudyRoundView = {
  id: string
  wordbookId: string
  mode: StudyRoundMode
  scope: StudyRoundScope
  meaningPreference: 'zh' | 'en'
  exerciseTypes: StudyExerciseType[]
  wordIds: string[]
  queue: StudyRoundTask[]
  passedTaskKeys: string[]
  completedWordIds: string[]
  masteredWordIds: string[]
  vagueWordIds: string[]
  unknownWordIds: string[]
  processedOperationIds: string[]
  revision: number
  createdAt: string
  updatedAt: string
  expiresAt: string
  completedAt?: string
  /** Derived for transport only; completed rounds have no current word. */
  currentWord: LearningQueueItem | null
}
export type StudyChoiceOption = {
  wordId: string
  word: string
  pos: string
  definition: string
}
export type StudyRoundTaskOptions = {
  taskId: string
  wordId: string
  options: StudyChoiceOption[]
}

export type ImportDraftLine = {
  line: number
  word: string
  sourceReason?: string
  phonetic?: string
  pos?: string
  enDefinition?: string
  zhMeaning?: string
  example?: string
  meanings?: WordMeaning[]
}

export type ImportDraftStatus = 'processing' | 'ready' | 'invalid' | 'duplicate' | 'unmatched' | 'conflict'
export type ImportConflictResolution = 'keep' | 'replace' | 'merge' | 'discard'

export type ImportDraftEntry = Omit<ImportDraftLine, 'word'> & {
  word?: string
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
  queued?: boolean
  createdAt?: string
  updatedAt?: string
}

export type ImportDraftTaskSummary = {
  groupId: string
  anchorId: string
  title: string
  targetWordbookId?: string
  status: 'processing' | 'pending'
  batchCount: number
  totalBatches: number
  completedBatches: number
  totalEntries: number
  completedEntries: number
  problemCount: number
  nextProcessingDraftId?: string
  queued?: boolean
  updatedAt: string
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
    public readonly details?: Record<string, unknown>,
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
      return new WorkspaceApiError(response.status, code, message, payload)
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

function parseDisplayPreferences(value: unknown): StudyDisplayPreferences | null {
  if (
    !isRecord(value)
    || (value.meaningPreference !== 'zh' && value.meaningPreference !== 'en')
    || typeof value.showExamples !== 'boolean'
    || typeof value.showPhonetic !== 'boolean'
    || typeof value.autoPlayAudio !== 'boolean'
  ) return null
  return {
    meaningPreference: value.meaningPreference,
    showExamples: value.showExamples,
    showPhonetic: value.showPhonetic,
    autoPlayAudio: value.autoPlayAudio,
  }
}

function parseFlashcardPreferences(value: unknown): FlashcardDisplayPreferences | null {
  const display = parseDisplayPreferences(value)
  if (!display || !isRecord(value)) return null
  const source = value.exerciseTypes === undefined
    ? ['self-rating', 'meaning-choice']
    : value.exerciseTypes
  if (!Array.isArray(source) || source.length < 1 || source.length > 2) return null
  const exerciseTypes = source.filter(
    (entry): entry is StudyExerciseType => entry === 'self-rating' || entry === 'meaning-choice',
  )
  if (exerciseTypes.length !== source.length || new Set(exerciseTypes).size !== exerciseTypes.length) return null
  return { ...display, exerciseTypes }
}

function parseWordbookStudyPreferences(value: unknown): WordbookStudyPreferences | null {
  if (!isRecord(value) || !isRecord(value.plan) || !isRecord(value.modes)) return null
  const count = (entry: unknown) => typeof entry === 'number' && Number.isInteger(entry) && entry >= 0 && entry <= 999 ? entry : null
  const newWords = count(value.plan.newWords)
  const dictationCount = count(value.plan.dictation)
  const backlogReviews = value.plan.backlogReviews === undefined ? 50 : count(value.plan.backlogReviews)
  const newMode = parseFlashcardPreferences(value.modes.new)
  const review = parseFlashcardPreferences(value.modes.review)
  const dictationBase = parseDisplayPreferences(value.modes.dictation)
  const dictationSource = value.modes.dictation
  if (
    newWords === null
    || dictationCount === null
    || backlogReviews === null
    || !newMode
    || !review
    || !dictationBase
    || !isRecord(dictationSource)
    || typeof dictationSource.underlineMistakes !== 'boolean'
    || typeof dictationSource.showMeaning !== 'boolean'
    || typeof dictationSource.showCharacterMask !== 'boolean'
  ) return null
  const dictation: DictationDisplayPreferences = {
    ...dictationBase,
    underlineMistakes: dictationSource.underlineMistakes,
    showMeaning: dictationSource.showMeaning,
    showCharacterMask: dictationSource.showCharacterMask,
  }
  return {
    plan: { newWords, dictation: dictationCount, backlogReviews },
    modes: { new: newMode, review, dictation },
  }
}

function parseStudyShortcuts(value: unknown): StudyShortcutPreferences | null {
  if (!isRecord(value)) return null
  const actions: StudyShortcutAction[] = ['unknown', 'vague', 'pronounce', 'known', 'mastered', 'flip', 'dictationPronounce']
  const parsed = {} as StudyShortcutPreferences
  for (const action of actions) {
    const source = (action === 'vague' || action === 'mastered') && value[action] === undefined
      ? DEFAULT_STUDY_SHORTCUTS[action]
      : value[action]
    if (typeof source !== 'string') return null
    const key = normalizeShortcutKey(source)
    if (!key) return null
    parsed[action] = key
  }
  if (value.mastered === undefined) {
    const used = [parsed.unknown, parsed.vague, parsed.pronounce, parsed.known, parsed.flip]
    parsed.mastered = ['r', 'f', 'x', 'c', 'z', '1', '2', '3', '4', '5'].find((key) => !used.includes(key)) ?? 'r'
  }
  const flashcard = [parsed.unknown, parsed.vague, parsed.pronounce, parsed.known, parsed.mastered, parsed.flip]
  if (new Set(flashcard).size !== flashcard.length || parsed.dictationPronounce === 'enter') return null
  return parsed
}

function parseSyncedStudySettings(value: unknown): SyncedStudySettings | null {
  if (!isRecord(value) || !isText(value.updatedAt) || !isRecord(value.pronunciation)) return null
  const shortcuts = parseStudyShortcuts(value.shortcuts)
  const accent = value.pronunciation.accent
  if (!shortcuts || (accent !== 'gb' && accent !== 'us')) return null
  return { shortcuts, pronunciation: { accent }, updatedAt: value.updatedAt }
}

function parseStudySettingsSnapshot(value: unknown): StudySettingsSnapshot | null {
  if (!isRecord(value)) return null
  if (value.settings === null) return { settings: null }
  const settings = parseSyncedStudySettings(value.settings)
  return settings ? { settings } : null
}

function parseMyWordbook(value: unknown): MyWordbook | null {
  if (!isRecord(value) || !isText(value.id) || !isText(value.title) || !isText(value.description) || !isText(value.createdAt) || !isText(value.updatedAt) || !isCount(value.wordCount)) return null
  const progress = parseProgress(value.progress)
  const reviewSchedule = value.reviewSchedule === undefined
    ? structuredClone(DEFAULT_REVIEW_SCHEDULE)
    : parseReviewSchedule(value.reviewSchedule)
  const studyPreferences = value.studyPreferences === undefined
    ? undefined
    : parseWordbookStudyPreferences(value.studyPreferences)
  if (
    !progress
    || (value.sourceCatalogId !== undefined && !isText(value.sourceCatalogId))
    || (value.sourceRevisionId !== undefined && !isText(value.sourceRevisionId))
    || (value.category !== undefined && !isText(value.category))
  ) return null
  if (!reviewSchedule || (value.studyPreferences !== undefined && !studyPreferences)) return null
  return {
    id: value.id,
    title: value.title,
    description: value.description,
    category: value.category,
    sourceCatalogId: value.sourceCatalogId,
    sourceRevisionId: value.sourceRevisionId,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    wordCount: value.wordCount,
    progress,
    reviewSchedule,
    ...(studyPreferences ? { studyPreferences } : {}),
  }
}

function parseDiffStats(value: unknown): CatalogDiffStats | null {
  if (
    !isRecord(value)
    || !isCount(value.additions)
    || !isCount(value.deletions)
    || !isCount(value.updates)
    || !isCount(value.changedWords)
  ) return null
  return {
    additions: value.additions,
    deletions: value.deletions,
    updates: value.updates,
    changedWords: value.changedWords,
  }
}

function isRevisionKind(value: unknown): value is CatalogRevisionKind {
  return value === 'initial' || value === 'update' || value === 'merge' || value === 'revert'
}

function parseRevisionSummary(value: unknown): CatalogRevisionSummary | null {
  if (
    !isRecord(value)
    || !isText(value.id)
    || !isRevisionKind(value.kind)
    || !isText(value.message)
    || !isText(value.author)
    || !isText(value.createdAt)
    || (value.committer !== undefined && !isText(value.committer))
    || (value.contributionId !== undefined && !isText(value.contributionId))
    || (value.revertsRevisionId !== undefined && !isText(value.revertsRevisionId))
  ) return null
  const stats = parseDiffStats(value.stats)
  if (!stats) return null
  return {
    id: value.id,
    kind: value.kind,
    message: value.message,
    author: value.author,
    committer: value.committer,
    createdAt: value.createdAt,
    stats,
    contributionId: value.contributionId,
    revertsRevisionId: value.revertsRevisionId,
  }
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
  if (value.updatedAt !== undefined && !isText(value.updatedAt)) return null
  if (value.headRevisionId !== undefined && !isText(value.headRevisionId)) return null
  if (value.collaborationEnabled !== undefined && typeof value.collaborationEnabled !== 'boolean') return null
  if (value.openContributionCount !== undefined && !isCount(value.openContributionCount)) return null
  const latestRevision = value.latestRevision === undefined ? undefined : parseRevisionSummary(value.latestRevision)
  if (value.latestRevision !== undefined && !latestRevision) return null
  const favoriteCount = isCount(value.favoriteCount) ? value.favoriteCount : 0
  return {
    id: value.id,
    title: value.title,
    description: value.description,
    author: value.author,
    exams,
    goals,
    rating: value.rating,
    uses: value.uses,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    headRevisionId: value.headRevisionId,
    shareCode: value.shareCode,
    wordCount: value.wordCount,
    favoriteCount,
    favorited,
    added,
    uploaded: value.uploaded,
    collaborationEnabled: value.collaborationEnabled,
    openContributionCount: value.openContributionCount,
    latestRevision: latestRevision ?? undefined,
    visibility: value.visibility,
    sourceWordbookId: value.sourceWordbookId,
  }
}

function parseAuthUser(value: unknown): AuthUser | null {
  if (!isRecord(value) || !isText(value.username) || !isText(value.clientId)) return null
  if (value.role !== 'user' && value.role !== 'admin') return null
  if (value.createdAt !== undefined && !isText(value.createdAt)) return null
  if (
    value.avatarUrl !== undefined
    && value.avatarUrl !== null
    && (!isText(value.avatarUrl) || !/^\/api\/account\/avatar\/[A-Za-z0-9_-]{8,128}$/.test(value.avatarUrl))
  ) return null
  if (!Array.isArray(value.capabilities)) return null
  const allowed: AuthCapability[] = ['site.settings.write', 'messages.moderate', 'messages.contact.read']
  if (!value.capabilities.every((item): item is AuthCapability => typeof item === 'string' && allowed.includes(item as AuthCapability))) return null
  return {
    username: value.username,
    clientId: value.clientId,
    role: value.role,
    ...(value.createdAt ? { createdAt: value.createdAt } : {}),
    ...(value.avatarUrl !== undefined ? { avatarUrl: value.avatarUrl } : {}),
    capabilities: [...value.capabilities],
  }
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

function parseCatalogWordsPage(value: unknown): CatalogWordsPage | null {
  if (
    !isRecord(value)
    || !Array.isArray(value.items)
    || !isCount(value.total)
    || !isCount(value.page)
    || !isCount(value.pageSize)
    || !isCount(value.totalPages)
    || !Number.isInteger(value.total)
    || !Number.isInteger(value.page)
    || !Number.isInteger(value.pageSize)
    || !Number.isInteger(value.totalPages)
    || value.page < 1
    || value.pageSize < 1
    || value.pageSize > 100
    || value.totalPages < 1
    || value.page > value.totalPages
  ) return null
  const items = value.items.map(parseCatalogEntry)
  if (items.some((word) => word === null) || items.length > value.pageSize) return null
  return {
    items: items as WordEntry[],
    total: value.total,
    page: value.page,
    pageSize: value.pageSize,
    totalPages: value.totalPages,
  }
}

export function parseCatalogWordChange(value: unknown): CatalogWordChange | null {
  if (!isRecord(value) || !isText(value.key)) return null
  if (value.kind === 'add') {
    const after = parseCatalogEntry(value.after)
    return after ? { kind: 'add', key: value.key, after } : null
  }
  if (value.kind === 'delete') {
    const before = parseCatalogEntry(value.before)
    return before ? { kind: 'delete', key: value.key, before } : null
  }
  if (value.kind === 'update') {
    const before = parseCatalogEntry(value.before)
    const after = parseCatalogEntry(value.after)
    return before && after ? { kind: 'update', key: value.key, before, after } : null
  }
  return null
}

function parseCatalogConflict(value: unknown): CatalogConflict | null {
  if (
    !isRecord(value)
    || !isText(value.key)
    || (value.reason !== 'overlapping-change' && value.reason !== 'source-diverged')
  ) return null
  const base = value.base === undefined ? undefined : parseCatalogEntry(value.base)
  const current = value.current === undefined ? undefined : parseCatalogEntry(value.current)
  const proposed = value.proposed === undefined ? undefined : parseCatalogEntry(value.proposed)
  if (
    (value.base !== undefined && !base)
    || (value.current !== undefined && !current)
    || (value.proposed !== undefined && !proposed)
  ) return null
  return {
    key: value.key,
    reason: value.reason,
    base: base ?? undefined,
    current: current ?? undefined,
    proposed: proposed ?? undefined,
  }
}

function parseCatalogRevision(value: unknown): CatalogRevision | null {
  const summary = parseRevisionSummary(value)
  if (
    !summary
    || !isRecord(value)
    || !isText(value.catalogId)
    || !isText(value.catalogTitle)
    || (value.parentRevisionId !== undefined && !isText(value.parentRevisionId))
    || !Array.isArray(value.changes)
    || typeof value.canRevert !== 'boolean'
  ) return null
  const changes = value.changes.map(parseCatalogWordChange)
  if (changes.some((change) => change === null)) return null
  return {
    ...summary,
    catalogId: value.catalogId,
    catalogTitle: value.catalogTitle,
    parentRevisionId: value.parentRevisionId,
    changes: changes as CatalogWordChange[],
    canRevert: value.canRevert,
  }
}

function parseCatalogContribution(value: unknown): CatalogContribution | null {
  if (
    !isRecord(value)
    || !isText(value.id)
    || !isText(value.catalogId)
    || !isText(value.catalogTitle)
    || !isText(value.contributor)
    || !isText(value.baseRevisionId)
    || !isText(value.submittedHeadRevisionId)
    || !isText(value.title)
    || !isText(value.description)
    || (value.status !== 'open' && value.status !== 'merged' && value.status !== 'closed')
    || !Array.isArray(value.changes)
    || !isText(value.createdAt)
    || !isText(value.updatedAt)
    || typeof value.canMerge !== 'boolean'
    || typeof value.canClose !== 'boolean'
    || (value.handledAt !== undefined && !isText(value.handledAt))
    || (value.handledBy !== undefined && !isText(value.handledBy))
    || (value.resolutionNote !== undefined && !isText(value.resolutionNote))
    || (value.mergedRevisionId !== undefined && !isText(value.mergedRevisionId))
  ) return null
  const stats = parseDiffStats(value.stats)
  const changes = value.changes.map(parseCatalogWordChange)
  if (!stats || changes.some((change) => change === null)) return null
  return {
    id: value.id,
    catalogId: value.catalogId,
    catalogTitle: value.catalogTitle,
    contributor: value.contributor,
    baseRevisionId: value.baseRevisionId,
    submittedHeadRevisionId: value.submittedHeadRevisionId,
    title: value.title,
    description: value.description,
    status: value.status,
    changes: changes as CatalogWordChange[],
    stats,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    handledAt: value.handledAt,
    handledBy: value.handledBy,
    resolutionNote: value.resolutionNote,
    mergedRevisionId: value.mergedRevisionId,
    canMerge: value.canMerge,
    canClose: value.canClose,
  }
}

function parseContributionPreview(value: unknown): ContributionPreview | null {
  if (
    !isRecord(value)
    || !isText(value.catalogId)
    || !isText(value.catalogTitle)
    || !isText(value.sourceWordbookId)
    || !isText(value.baseRevisionId)
    || !isText(value.headRevisionId)
    || !isText(value.expectedSourceUpdatedAt)
    || !isText(value.expectedHeadRevisionId)
    || typeof value.legacyBaseline !== 'boolean'
    || !Array.isArray(value.changes)
    || !Array.isArray(value.overlaps)
  ) return null
  const stats = parseDiffStats(value.stats)
  const changes = value.changes.map(parseCatalogWordChange)
  const overlaps = value.overlaps.map(parseCatalogConflict)
  if (!stats || changes.some((change) => change === null) || overlaps.some((conflict) => conflict === null)) return null
  return {
    catalogId: value.catalogId,
    catalogTitle: value.catalogTitle,
    sourceWordbookId: value.sourceWordbookId,
    baseRevisionId: value.baseRevisionId,
    headRevisionId: value.headRevisionId,
    expectedSourceUpdatedAt: value.expectedSourceUpdatedAt,
    expectedHeadRevisionId: value.expectedHeadRevisionId,
    legacyBaseline: value.legacyBaseline,
    changes: changes as CatalogWordChange[],
    stats,
    overlaps: overlaps as CatalogConflict[],
  }
}

function parseRevertPreview(value: unknown): RevertPreview | null {
  if (
    !isRecord(value)
    || !isText(value.catalogId)
    || !isText(value.revisionId)
    || !isText(value.headRevisionId)
    || !Array.isArray(value.changes)
    || !Array.isArray(value.conflicts)
    || typeof value.alreadyReverted !== 'boolean'
  ) return null
  const stats = parseDiffStats(value.stats)
  const changes = value.changes.map(parseCatalogWordChange)
  const conflicts = value.conflicts.map(parseCatalogConflict)
  if (!stats || changes.some((change) => change === null) || conflicts.some((conflict) => conflict === null)) return null
  return {
    catalogId: value.catalogId,
    revisionId: value.revisionId,
    headRevisionId: value.headRevisionId,
    changes: changes as CatalogWordChange[],
    stats,
    conflicts: conflicts as CatalogConflict[],
    alreadyReverted: value.alreadyReverted,
  }
}

function parseCursorPage<T>(value: unknown, parser: (item: unknown) => T | null): CursorPage<T> | null {
  if (!isRecord(value) || !Array.isArray(value.items) || (value.nextCursor !== undefined && !isText(value.nextCursor))) return null
  const items = value.items.map(parser)
  return items.some((item) => item === null)
    ? null
    : { items: items as T[], ...(value.nextCursor ? { nextCursor: value.nextCursor } : {}) }
}

function isWordLevel(value: unknown): value is WordLevel {
  return value === 0 || value === 1 || value === 2 || value === 3 || value === 4
}

function parseWord(value: unknown): MyWordbookWord | null {
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
  if (value.reviewIntervalDays !== undefined && !isCount(value.reviewIntervalDays)) return null
  if (value.nextReviewAt !== undefined && !isText(value.nextReviewAt)) return null
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
    reviewIntervalDays: value.reviewIntervalDays,
    nextReviewAt: value.nextReviewAt,
    recognitionStreak: value.recognitionStreak as RecognitionStreak | undefined,
  }
}

function parseMyWordbookWordsPage(value: unknown): MyWordbookWordsPage | null {
  if (
    !isRecord(value)
    || !Array.isArray(value.items)
    || !isCount(value.total)
    || !isCount(value.page)
    || !isCount(value.pageSize)
    || !isCount(value.totalPages)
    || !isCount(value.totalWordCount)
    || !Number.isInteger(value.total)
    || !Number.isInteger(value.page)
    || !Number.isInteger(value.pageSize)
    || !Number.isInteger(value.totalPages)
    || !Number.isInteger(value.totalWordCount)
    || value.page < 1
    || value.pageSize < 1
    || value.pageSize > 100
    || value.totalPages < 1
    || value.page > value.totalPages
  ) return null
  const items = value.items.map(parseWord)
  const levelCounts = parseLevelCounts(value.levelCounts)
  if (items.some((item) => item === null) || items.length > value.pageSize || !levelCounts) return null
  return {
    items: items as MyWordbookWord[],
    total: value.total,
    page: value.page,
    pageSize: value.pageSize,
    totalPages: value.totalPages,
    totalWordCount: value.totalWordCount,
    levelCounts,
  }
}

function parseBatchWordResult(value: unknown, action: BatchWordAction): BatchWordResult | null {
  if (!isRecord(value) || value.action !== action || !Array.isArray(value.succeededIds) || !value.succeededIds.every(isText) || !Array.isArray(value.failed)) return null
  const failed = value.failed.map((item) => isRecord(item) && isText(item.wordId) && (item.code === 'WORD_NOT_FOUND' || item.code === 'DICTIONARY_UNAVAILABLE')
    ? { wordId: item.wordId, code: item.code }
    : null)
  return failed.some((item) => item === null)
    ? null
    : { action, succeededIds: value.succeededIds, failed: failed as BatchWordResult['failed'] }
}

function parsePlan(value: unknown) {
  if (!isRecord(value)) return null
  const parse = (entry: unknown) => isRecord(entry) && isCount(entry.target) && isCount(entry.completed) ? { target: entry.target, completed: entry.completed } : null
  const newPlan = parse(value.new); const review = parse(value.review); const dictation = parse(value.dictation)
  return newPlan && review && dictation ? { new: newPlan, review, dictation } : null
}

/** Shared by the API client and the browser dashboard cache to reject corrupted snapshots. */
export function parseStudyDashboard(value: unknown): StudyDashboard | null {
  if (!isRecord(value) || !isText(value.updatedAt) || !Array.isArray(value.recentActivity) || !Array.isArray(value.calendar) || !isRecord(value.week) || !isCount(value.streakDays)) return null
  const wordbook = parseMyWordbook(value.wordbook); const todayPlan = parsePlan(value.todayPlan)
  if (!wordbook || !todayPlan || !isCount(value.week.newCount) || !isCount(value.week.reviewCount) || !isCount(value.week.dictationCount) || !isCount(value.week.total)) return null
  const recentActivity = value.recentActivity.map((entry) => {
    if (!isRecord(entry) || !isText(entry.id) || !isText(entry.kind) || !isText(entry.wordbookId) || !isText(entry.word) || !isText(entry.occurredAt)) return null
    if (entry.kind !== 'new' && entry.kind !== 'flashcard' && entry.kind !== 'dictation' && entry.kind !== 'mark') return null
    if (entry.verdict !== undefined && entry.verdict !== 'know' && entry.verdict !== 'vague' && entry.verdict !== 'unknown') return null
    if (entry.correct !== undefined && typeof entry.correct !== 'boolean') return null
    if (entry.level !== undefined && !isWordLevel(entry.level)) return null
    if (entry.levelAfter !== undefined && !isWordLevel(entry.levelAfter)) return null
    return { id: entry.id, kind: entry.kind, wordbookId: entry.wordbookId, word: entry.word, occurredAt: entry.occurredAt, verdict: entry.verdict, correct: entry.correct, level: entry.level, levelAfter: entry.levelAfter }
  })
  const calendar = value.calendar.map((entry) => isRecord(entry) && isText(entry.date) && isCount(entry.count) && typeof entry.active === 'boolean' ? { date: entry.date, count: entry.count, active: entry.active } : null)
  if (recentActivity.some((entry) => entry === null) || calendar.some((entry) => entry === null)) return null
  if (value.finalCheckDue !== undefined && !isCount(value.finalCheckDue)) return null
  let reviewBreakdown: StudyDashboard['reviewBreakdown']
  if (value.reviewBreakdown !== undefined) {
    if (
      !isRecord(value.reviewBreakdown)
      || !isCount(value.reviewBreakdown.protected)
      || !isCount(value.reviewBreakdown.regular)
      || !isCount(value.reviewBreakdown.backlog)
      || !isCount(value.reviewBreakdown.scheduled)
    ) return null
    reviewBreakdown = {
      protected: value.reviewBreakdown.protected,
      regular: value.reviewBreakdown.regular,
      backlog: value.reviewBreakdown.backlog,
      scheduled: value.reviewBreakdown.scheduled,
    }
  }
  let activeRounds: StudyDashboard['activeRounds']
  if (value.activeRounds !== undefined) {
    if (!Array.isArray(value.activeRounds)) return null
    const parsed = value.activeRounds.map((round) => (
      isRecord(round)
        && isText(round.id)
        && (round.mode === 'new' || round.mode === 'review')
        && (round.scope === 'standard' || round.scope === 'backlog' || round.scope === 'ahead')
        && isCount(round.remainingWords)
        && isText(round.updatedAt)
        ? {
            id: round.id,
            mode: round.mode,
            scope: round.scope,
            remainingWords: round.remainingWords,
            updatedAt: round.updatedAt,
          }
        : null
    ))
    if (parsed.some((round) => round === null)) return null
    activeRounds = parsed as NonNullable<StudyDashboard['activeRounds']>
  }
  return {
    wordbook,
    todayPlan,
    recentActivity: recentActivity as StudyDashboard['recentActivity'],
    calendar: calendar as StudyDashboard['calendar'],
    week: { newCount: value.week.newCount, reviewCount: value.week.reviewCount, dictationCount: value.week.dictationCount, total: value.week.total },
    streakDays: value.streakDays,
    ...(reviewBreakdown ? { reviewBreakdown } : {}),
    ...(activeRounds ? { activeRounds } : {}),
    ...(value.finalCheckDue !== undefined ? { finalCheckDue: value.finalCheckDue } : {}),
    updatedAt: value.updatedAt,
  }
}

function parseLearningQueueItem(value: unknown): LearningQueueItem | null {
  const word = parseWord(value)
  return word
    && word.status !== undefined
    && word.level !== undefined
    && word.reviewIntervalDays !== undefined
    && word.recognitionStreak !== undefined
    ? word as LearningQueueItem
    : null
}

export function parseAccountStudyProfile(value: unknown): AccountStudyProfile | null {
  if (!isRecord(value) || !Array.isArray(value.activity) || !Array.isArray(value.recentActivity)) return null
  const metrics = value.metrics
  const activityWindow = value.activityWindow
  if (!isRecord(metrics) || !isRecord(activityWindow)) return null
  const wordbookCount = metrics.wordbookCount
  const wordCount = metrics.wordCount
  const learnedWordCount = metrics.learnedWordCount
  const currentStreak = metrics.currentStreak
  const longestStreak = metrics.longestStreak
  if (!isCount(wordbookCount) || !isCount(wordCount) || !isCount(learnedWordCount) || !isCount(currentStreak) || !isCount(longestStreak)) return null
  if (
    !isText(activityWindow.startDate)
    || !isText(activityWindow.endDate)
    || activityWindow.days !== 90
  ) return null
  const activity = value.activity.map((entry) => (
    isRecord(entry) && isText(entry.date) && isCount(entry.count)
      ? { date: entry.date, count: entry.count }
      : null
  ))
  if (activity.some((entry) => entry === null) || activity.length !== 90) return null
  const recentActivity = value.recentActivity.map((entry) => {
    if (
      !isRecord(entry)
      || !isText(entry.id)
      || (entry.kind !== 'new' && entry.kind !== 'flashcard' && entry.kind !== 'dictation' && entry.kind !== 'mark')
      || !isText(entry.wordbookId)
      || !isText(entry.wordbookTitle)
      || !isText(entry.word)
      || !isText(entry.occurredAt)
    ) return null
    if (entry.verdict !== undefined && entry.verdict !== 'know' && entry.verdict !== 'vague' && entry.verdict !== 'unknown') return null
    if (entry.correct !== undefined && typeof entry.correct !== 'boolean') return null
    if (entry.level !== undefined && !isWordLevel(entry.level)) return null
    if (entry.levelAfter !== undefined && !isWordLevel(entry.levelAfter)) return null
    return {
      id: entry.id,
      kind: entry.kind,
      wordbookId: entry.wordbookId,
      wordbookTitle: entry.wordbookTitle,
      word: entry.word,
      occurredAt: entry.occurredAt,
      verdict: entry.verdict,
      correct: entry.correct,
      level: entry.level,
      levelAfter: entry.levelAfter,
    }
  })
  if (recentActivity.some((entry) => entry === null)) return null
  return {
    metrics: {
      wordbookCount,
      wordCount,
      learnedWordCount,
      currentStreak,
      longestStreak,
    },
    activityWindow: {
      startDate: activityWindow.startDate,
      endDate: activityWindow.endDate,
      days: 90,
    },
    activity: activity as AccountStudyProfile['activity'],
    recentActivity: recentActivity as AccountStudyProfileActivity[],
  }
}

function parseStudyRoundTask(value: unknown): StudyRoundTask | null {
  if (!isRecord(value) || !isText(value.id) || !isText(value.wordId)) return null
  if (value.exercise !== 'self-rating' && value.exercise !== 'meaning-choice') return null
  return { id: value.id, wordId: value.wordId, exercise: value.exercise }
}

function parseStudyRound(value: unknown): StudyRoundView | null {
  if (
    !isRecord(value)
    || !isText(value.id)
    || !isText(value.wordbookId)
    || (value.mode !== 'new' && value.mode !== 'review')
    || (value.scope !== 'standard' && value.scope !== 'backlog' && value.scope !== 'ahead')
    || (value.meaningPreference !== 'zh' && value.meaningPreference !== 'en')
    || !Array.isArray(value.exerciseTypes)
    || !Array.isArray(value.wordIds)
    || !Array.isArray(value.queue)
    || !Array.isArray(value.passedTaskKeys)
    || !Array.isArray(value.completedWordIds)
    || (value.masteredWordIds !== undefined && !Array.isArray(value.masteredWordIds))
    || !Array.isArray(value.vagueWordIds)
    || !Array.isArray(value.unknownWordIds)
    || !Array.isArray(value.processedOperationIds)
    || !isCount(value.revision)
    || !Number.isInteger(value.revision)
    || !isText(value.createdAt)
    || !isText(value.updatedAt)
    || !isText(value.expiresAt)
    || (value.completedAt !== undefined && !isText(value.completedAt))
  ) return null
  const exerciseTypes = value.exerciseTypes.filter(
    (entry): entry is StudyExerciseType => entry === 'self-rating' || entry === 'meaning-choice',
  )
  const queue = value.queue.map(parseStudyRoundTask)
  const currentWord = value.currentWord === null ? null : parseLearningQueueItem(value.currentWord)
  const stringArrays = [
    value.wordIds,
    value.passedTaskKeys,
    value.completedWordIds,
    value.masteredWordIds ?? [],
    value.vagueWordIds,
    value.unknownWordIds,
    value.processedOperationIds,
  ]
  if (
    exerciseTypes.length < 1
    || exerciseTypes.length !== value.exerciseTypes.length
    || new Set(exerciseTypes).size !== exerciseTypes.length
    || queue.some((task) => task === null)
    || stringArrays.some((array) => !array.every(isText))
    || (value.currentWord !== null && currentWord === null)
    || (currentWord !== null && currentWord.id !== queue[0]?.wordId)
    || (queue.length === 0 && currentWord !== null)
  ) return null
  return {
    id: value.id,
    wordbookId: value.wordbookId,
    mode: value.mode,
    scope: value.scope,
    meaningPreference: value.meaningPreference,
    exerciseTypes,
    wordIds: value.wordIds as string[],
    queue: queue as StudyRoundTask[],
    passedTaskKeys: value.passedTaskKeys as string[],
    completedWordIds: value.completedWordIds as string[],
    masteredWordIds: (value.masteredWordIds ?? []) as string[],
    vagueWordIds: value.vagueWordIds as string[],
    unknownWordIds: value.unknownWordIds as string[],
    processedOperationIds: value.processedOperationIds as string[],
    revision: value.revision,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    expiresAt: value.expiresAt,
    completedAt: value.completedAt,
    currentWord,
  }
}

function parseStudyRoundStart(value: unknown): { round: StudyRoundView; resumed: boolean } | null {
  if (!isRecord(value) || typeof value.resumed !== 'boolean') return null
  const round = parseStudyRound(value.round)
  return round ? { round, resumed: value.resumed } : null
}

function parseStudyRoundTaskOptions(value: unknown): StudyRoundTaskOptions | null {
  if (!isRecord(value) || !isText(value.taskId) || !isText(value.wordId) || !Array.isArray(value.options)) return null
  const options = value.options.map((option): StudyChoiceOption | null => (
    isRecord(option)
      && isText(option.wordId)
      && isText(option.word)
      && isText(option.pos)
      && isText(option.definition)
      ? { wordId: option.wordId, word: option.word, pos: option.pos, definition: option.definition }
      : null
  ))
  return options.some((option) => option === null)
    ? null
    : { taskId: value.taskId, wordId: value.wordId, options: options as StudyChoiceOption[] }
}

function parseImportStatus(value: unknown): ImportDraftStatus | null {
  return value === 'processing' || value === 'ready' || value === 'invalid' || value === 'duplicate' || value === 'unmatched' || value === 'conflict' ? value : null
}

function parseImportDraftEntry(value: unknown): ImportDraftEntry | null {
  if (!isRecord(value) || !isCount(value.line) || (value.word !== undefined && !isText(value.word))) return null
  const status = parseImportStatus(value.status) ?? 'ready'
  if (
    (value.id !== undefined && !isText(value.id)) ||
    (value.sourceReason !== undefined && !isText(value.sourceReason)) ||
    (value.phonetic !== undefined && !isText(value.phonetic)) ||
    (value.pos !== undefined && !isText(value.pos)) ||
    (value.enDefinition !== undefined && !isText(value.enDefinition)) ||
    (value.zhMeaning !== undefined && !isText(value.zhMeaning)) ||
    (value.example !== undefined && !isText(value.example)) ||
    (value.meanings !== undefined && (!Array.isArray(value.meanings) || value.meanings.some((meaning) => parseMeaning(meaning) === null))) ||
    (value.entry !== undefined && parseCatalogEntry(value.entry) === null) ||
    (value.reason !== undefined && !isText(value.reason)) ||
    (value.conflictWith !== undefined && !isText(value.conflictWith)) ||
    (value.resolution !== undefined && value.resolution !== 'keep' && value.resolution !== 'replace' && value.resolution !== 'merge' && value.resolution !== 'discard')
  ) return null
  return {
    line: value.line,
    word: value.word,
    sourceReason: value.sourceReason,
    phonetic: value.phonetic,
    pos: value.pos,
    enDefinition: value.enDefinition,
    zhMeaning: value.zhMeaning,
    example: value.example,
    meanings: value.meanings === undefined ? undefined : value.meanings.map(parseMeaning) as WordMeaning[],
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
    || (value.queued !== undefined && typeof value.queued !== 'boolean')
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
    queued: value.queued,
    updatedAt: value.updatedAt,
  }
}

function parseImportDraftTaskSummary(value: unknown): ImportDraftTaskSummary | null {
  if (
    !isRecord(value)
    || !isText(value.groupId)
    || !isText(value.anchorId)
    || !isText(value.title)
    || (value.targetWordbookId !== undefined && !isText(value.targetWordbookId))
    || (value.status !== 'processing' && value.status !== 'pending')
    || !isCount(value.batchCount)
    || !isCount(value.totalBatches)
    || !isCount(value.completedBatches)
    || !isCount(value.totalEntries)
    || !isCount(value.completedEntries)
    || !isCount(value.problemCount)
    || (value.nextProcessingDraftId !== undefined && !isText(value.nextProcessingDraftId))
    || (value.queued !== undefined && typeof value.queued !== 'boolean')
    || !isText(value.updatedAt)
  ) return null
  return {
    groupId: value.groupId,
    anchorId: value.anchorId,
    title: value.title,
    targetWordbookId: value.targetWordbookId,
    status: value.status,
    batchCount: value.batchCount,
    totalBatches: value.totalBatches,
    completedBatches: value.completedBatches,
    totalEntries: value.totalEntries,
    completedEntries: value.completedEntries,
    problemCount: value.problemCount,
    nextProcessingDraftId: value.nextProcessingDraftId,
    queued: value.queued,
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
  getCatalogSummary(id: string) { return this.json(`api/catalog/wordbooks/${encodeURIComponent(id)}/summary`, {}, parseCatalog) }
  listCatalogWords(id: string, query: CatalogWordsQuery = {}) {
    const url = new URL(`api/catalog/wordbooks/${encodeURIComponent(id)}/words`, this.baseUrl)
    if (query.page !== undefined) url.searchParams.set('page', String(query.page))
    if (query.pageSize !== undefined) url.searchParams.set('pageSize', String(query.pageSize))
    if (query.q?.trim()) url.searchParams.set('q', query.q.trim())
    return this.jsonUrl(url, {}, parseCatalogWordsPage)
  }
  async toggleFavorite(id: string) { return invalidateMarketplaceAfter(this.json<{ favorited: boolean; favoriteCount: number }>(`api/catalog/wordbooks/${encodeURIComponent(id)}/favorite`, { method: 'POST' }, (value) => isRecord(value) && typeof value.favorited === 'boolean' && isCount(value.favoriteCount) ? { favorited: value.favorited, favoriteCount: value.favoriteCount } : null)) }
  async addCatalog(id: string) { return invalidateMarketplaceAfter(this.json<{ wordbook: MyWordbook; created: boolean }>(`api/catalog/wordbooks/${encodeURIComponent(id)}/add`, { method: 'POST' }, (value) => isRecord(value) && typeof value.created === 'boolean' && parseMyWordbook(value.wordbook) ? { wordbook: parseMyWordbook(value.wordbook)!, created: value.created } : null)) }
  async upload(input: { title: string; description?: string; exams?: string[]; goals?: string[]; words: WordEntry[]; visibility?: CatalogVisibility; message?: string }) { return invalidateMarketplaceAfter(this.json('api/catalog/uploads', { method: 'POST', body: JSON.stringify(input) }, parseCatalog)) }
  uploadWordbook(input: { sourceWordbookId: string; title?: string; description?: string; exams?: string[]; goals?: string[]; visibility?: CatalogVisibility; message?: string }) { return invalidateMarketplaceAfter(this.json('api/catalog/uploads', { method: 'POST', body: JSON.stringify(input) }, parseCatalog)) }
  updateCatalogSnapshot(catalogId: string, input: { sourceWordbookId?: string; expectedHeadRevisionId?: string; title?: string; description?: string; exams?: string[]; goals?: string[]; visibility?: CatalogVisibility; message?: string }) { return invalidateMarketplaceAfter(this.json(`api/catalog/wordbooks/${encodeURIComponent(catalogId)}`, { method: 'PATCH', body: JSON.stringify(input) }, parseCatalog)) }
  async importShareCode(shareCode: string) { return invalidateMarketplaceAfter(this.json<{ wordbook: MyWordbook; created: boolean }>('api/catalog/imports', { method: 'POST', body: JSON.stringify({ shareCode }) }, (value) => isRecord(value) && typeof value.created === 'boolean' && parseMyWordbook(value.wordbook) ? { wordbook: parseMyWordbook(value.wordbook)!, created: value.created } : null)) }
  getContributionPreview(wordbookId: string) {
    return this.json(`api/my/wordbooks/${encodeURIComponent(wordbookId)}/contribution-preview`, {}, parseContributionPreview)
  }
  createContribution(catalogId: string, input: {
    title: string
    description?: string
    expectedSourceUpdatedAt: string
    expectedHeadRevisionId: string
  }) {
    return invalidateMarketplaceAfter(this.json(
      `api/catalog/wordbooks/${encodeURIComponent(catalogId)}/contributions`,
      { method: 'POST', body: JSON.stringify(input) },
      parseCatalogContribution,
    ))
  }
  listCatalogContributions(catalogId: string, cursor?: string, limit = 20) {
    const url = new URL(`api/catalog/wordbooks/${encodeURIComponent(catalogId)}/contributions`, this.baseUrl)
    if (cursor) url.searchParams.set('cursor', cursor)
    url.searchParams.set('limit', String(limit))
    return this.jsonUrl(url, {}, (value) => parseCursorPage(value, parseCatalogContribution))
  }
  getCatalogContribution(catalogId: string, contributionId: string) {
    return this.json(
      `api/catalog/wordbooks/${encodeURIComponent(catalogId)}/contributions/${encodeURIComponent(contributionId)}`,
      {},
      parseCatalogContribution,
    )
  }
  mergeContribution(catalogId: string, contributionId: string, input: { expectedHeadRevisionId?: string; resolutionNote?: string } = {}) {
    return invalidateMarketplaceAfter(this.json(
      `api/catalog/wordbooks/${encodeURIComponent(catalogId)}/contributions/${encodeURIComponent(contributionId)}/merge`,
      { method: 'POST', body: JSON.stringify(input) },
      parseCatalogContribution,
    ))
  }
  closeContribution(catalogId: string, contributionId: string, resolutionNote?: string) {
    return invalidateMarketplaceAfter(this.json(
      `api/catalog/wordbooks/${encodeURIComponent(catalogId)}/contributions/${encodeURIComponent(contributionId)}/close`,
      { method: 'POST', body: JSON.stringify({ ...(resolutionNote !== undefined ? { resolutionNote } : {}) }) },
      parseCatalogContribution,
    ))
  }
  listCatalogRevisions(catalogId: string, cursor?: string, limit = 20) {
    const url = new URL(`api/catalog/wordbooks/${encodeURIComponent(catalogId)}/revisions`, this.baseUrl)
    if (cursor) url.searchParams.set('cursor', cursor)
    url.searchParams.set('limit', String(limit))
    return this.jsonUrl(url, {}, (value) => parseCursorPage(value, parseCatalogRevision))
  }
  getCatalogRevision(catalogId: string, revisionId: string) {
    return this.json(
      `api/catalog/wordbooks/${encodeURIComponent(catalogId)}/revisions/${encodeURIComponent(revisionId)}`,
      {},
      parseCatalogRevision,
    )
  }
  getRevertPreview(catalogId: string, revisionId: string) {
    return this.json(
      `api/catalog/wordbooks/${encodeURIComponent(catalogId)}/revisions/${encodeURIComponent(revisionId)}/revert-preview`,
      {},
      parseRevertPreview,
    )
  }
  revertRevision(catalogId: string, revisionId: string, input: { expectedHeadRevisionId: string; message?: string }) {
    return invalidateMarketplaceAfter(this.json(
      `api/catalog/wordbooks/${encodeURIComponent(catalogId)}/revisions/${encodeURIComponent(revisionId)}/revert`,
      { method: 'POST', body: JSON.stringify(input) },
      parseCatalogRevision,
    ))
  }
  listAccountContributions(scope: 'review' | 'authored', cursor?: string, limit = 20) {
    const url = new URL('api/account/contributions', this.baseUrl)
    url.searchParams.set('scope', scope)
    url.searchParams.set('limit', String(limit))
    if (cursor) url.searchParams.set('cursor', cursor)
    return this.jsonUrl(url, {}, (value): ContributionInboxPage | null => {
      if (!isRecord(value) || !isCount(value.openCount)) return null
      const page = parseCursorPage(value, parseCatalogContribution)
      return page ? { ...page, openCount: value.openCount } : null
    })
  }
  getStudySettings() { return this.json('api/my/study-settings', {}, parseStudySettingsSnapshot) }
  updateStudySettings(input: { shortcuts?: StudyShortcutPreferences; pronunciation?: PronunciationPreferences }) {
    return this.json('api/my/study-settings', { method: 'PATCH', body: JSON.stringify(input) }, parseSyncedStudySettings)
  }
  listMyWordbooks(trash = false) { const url = new URL('api/my/wordbooks', this.baseUrl); if (trash) url.searchParams.set('view', 'trash'); return this.list(url, parseMyWordbook, 'wordbook list') }
  createMyWordbook(input: { title: string; description?: string; category?: string; words?: WordEntry[] }) { return this.json('api/my/wordbooks', { method: 'POST', body: JSON.stringify(input) }, parseMyWordbook) }
  updateMyWordbook(id: string, input: { category?: string | null; reviewSchedule?: ReviewSchedule; studyPreferences?: WordbookStudyPreferences }) { return this.json(`api/my/wordbooks/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) }, parseMyWordbook) }
  createImportDraft(input: { title: string; description?: string; targetWordbookId?: string; lines: ImportDraftLine[] }) {
    return notifyImportDraftsAfter(this.json('api/my/import-drafts', { method: 'POST', body: JSON.stringify(input) }, parseImportDraft, 120_000))
  }
  listImportDrafts() { return this.list(new URL('api/my/import-drafts', this.baseUrl), parseImportDraft, 'import drafts', 120_000) }
  listImportDraftTasks() { return this.list(new URL('api/my/import-drafts/status', this.baseUrl), parseImportDraftTaskSummary, 'import draft tasks', 30_000) }
  getImportDraft(id: string) { return this.json(`api/my/import-drafts/${encodeURIComponent(id)}`, {}, parseImportDraft, 120_000) }
  processImportDraft(id: string) { return this.json(`api/my/import-drafts/${encodeURIComponent(id)}/process`, { method: 'POST' }, parseImportDraft, 120_000) }
  deleteImportDraft(id: string) { return notifyImportDraftsAfter(this.empty(`api/my/import-drafts/${encodeURIComponent(id)}`, { method: 'DELETE' })) }
  commitImportDraft(id: string, resolutions: Record<string, ImportConflictResolution> = {}, mode: 'append' | 'overwrite' = 'append') { return notifyImportDraftsAfter(this.json(`api/my/import-drafts/${encodeURIComponent(id)}/commit`, { method: 'POST', body: JSON.stringify({ mode, resolutions }) }, parseMyWordbook, 120_000)) }
  deleteMyWordbook(id: string) { return invalidateMarketplaceAfter(this.empty(`api/my/wordbooks/${encodeURIComponent(id)}`, { method: 'DELETE' })) }
  restoreMyWordbook(id: string) { return invalidateMarketplaceAfter(this.json(`api/my/wordbooks/${encodeURIComponent(id)}/restore`, { method: 'POST' }, parseMyWordbook)) }
  listWords(id: string, status?: WordStatus) { const url = new URL(`api/my/wordbooks/${encodeURIComponent(id)}/words`, this.baseUrl); if (status) url.searchParams.set('status', status); return this.list(url, parseWord, 'word list', 120_000) }
  listWordPage(id: string, query: MyWordbookWordsQuery = {}) {
    const url = new URL(`api/my/wordbooks/${encodeURIComponent(id)}/words/page`, this.baseUrl)
    if (query.page !== undefined) url.searchParams.set('page', String(query.page))
    if (query.pageSize !== undefined) url.searchParams.set('pageSize', String(query.pageSize))
    if (query.q?.trim()) url.searchParams.set('q', query.q.trim())
    if (query.level !== undefined) url.searchParams.set('level', String(query.level))
    return this.jsonUrl(url, {}, parseMyWordbookWordsPage)
  }
  updateWord(wordbookId: string, wordId: string, input: UpdateWordInput) { return this.json(`api/my/wordbooks/${encodeURIComponent(wordbookId)}/words/${encodeURIComponent(wordId)}`, { method: 'PATCH', body: JSON.stringify(input) }, parseWord) }
  async batchWords(wordbookId: string, action: BatchWordAction, wordIds: string[]): Promise<BatchWordResult> {
    const result: BatchWordResult = { action, succeededIds: [], failed: [] }
    for (let start = 0; start < wordIds.length; start += 500) {
      const chunk = wordIds.slice(start, start + 500)
      const completed = await this.json(
        `api/my/wordbooks/${encodeURIComponent(wordbookId)}/words/batch`,
        { method: 'POST', body: JSON.stringify({ action, wordIds: chunk }) },
        (value) => parseBatchWordResult(value, action),
        120_000,
      )
      result.succeededIds.push(...completed.succeededIds)
      result.failed.push(...completed.failed)
    }
    return result
  }
  getDashboard(id: string) { return this.json(`api/study/dashboard/${encodeURIComponent(id)}`, {}, parseStudyDashboard) }
  getAccountProfile() { return this.json('api/account/profile', {}, parseAccountStudyProfile) }
  startStudyRound(wordbookId: string, mode: StudyRoundMode, scope: StudyRoundScope = 'standard') {
    return this.json(
      'api/study/rounds',
      { method: 'POST', body: JSON.stringify({ wordbookId, mode, scope }) },
      parseStudyRoundStart,
    )
  }
  getStudyRound(id: string) {
    return this.json(`api/study/rounds/${encodeURIComponent(id)}`, {}, parseStudyRound)
  }
  getStudyRoundTaskOptions(id: string, taskId: string, meaningPreference: MeaningPreference) {
    return this.json(
      `api/study/rounds/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}/options?meaningPreference=${meaningPreference}`,
      {},
      parseStudyRoundTaskOptions,
    )
  }
  rotateStudyRound(id: string, revision: number) {
    return this.json(
      `api/study/rounds/${encodeURIComponent(id)}/rotate`,
      { method: 'POST', body: JSON.stringify({ revision }) },
      parseStudyRound,
    )
  }
  answerStudyRound(
    id: string,
    input: {
      taskId: string
      response: LearningVerdict | 'correct' | 'incorrect' | 'mastered'
      operationId: string
      revision: number
    },
  ) {
    return this.json(
      `api/study/rounds/${encodeURIComponent(id)}/answers`,
      { method: 'POST', body: JSON.stringify(input) },
      parseStudyRound,
    )
  }
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
  deleteCatalogUpload(id: string) { return invalidateMarketplaceAfter(this.empty(`api/catalog/wordbooks/${encodeURIComponent(id)}`, { method: 'DELETE' })) }

  /* ── Accounts (session cookie; the server binds the account's data clientId) ── */
  register(username: string, password: string) { return this.json('api/auth/register', { method: 'POST', body: JSON.stringify({ username, password }) }, parseAuthUser) }
  login(username: string, password: string) { return this.json('api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }, parseAuthUser) }
  logout() { return this.empty('api/auth/logout', { method: 'POST' }) }
  changePassword(currentPassword: string, newPassword: string) {
    return this.empty('api/account/password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    })
  }
  uploadAccountAvatar(image: Blob) {
    return this.json('api/account/avatar', {
      method: 'PUT',
      headers: { 'Content-Type': image.type },
      body: image,
    }, parseAuthUser)
  }
  deleteAccountAvatar() {
    return this.json('api/account/avatar', { method: 'DELETE' }, parseAuthUser)
  }
  async exportAccount(): Promise<unknown> {
    // A full account export can carry tens of megabytes; give it a long timeout
    // instead of the 8s default so the download is not aborted mid-transfer.
    const response = await this.fetch(new URL('api/account/export', this.baseUrl), this.requestInit({}, 120_000))
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

  private async list<T>(url: URL, parser: (value: unknown) => T | null, label: string, timeoutMs = this.timeoutMs): Promise<T[]> {
    const payload = await this.request(url, {}, timeoutMs)
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
  private async jsonUrl<T>(
    url: URL,
    init: RequestInit,
    parser: (value: unknown) => T | null,
    timeoutMs = this.timeoutMs,
  ): Promise<T> {
    const payload = await this.request(url, init, timeoutMs)
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
