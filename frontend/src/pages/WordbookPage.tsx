import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { ContributionSubmitDialog } from '../components/marketplace/ContributionSubmitDialog'
import { DictationPrompt } from '../components/word/DictationPrompt'
import { DictationSummary } from '../components/word/DictationSummary'
import { ImportWordbookDialog } from '../components/word/ImportWordbookDialog'
import { ShortcutHint } from '../components/word/ShortcutHint'
import {
  WordManagerDialog,
  type WordManagerLevelFilter,
  type WordbookWordPatch,
} from '../components/wordbook/WordManagerDialog'
import {
  getWorkspaceApi,
  type BatchWordAction,
  type BatchWordResult,
  type CatalogWordbook,
  type MyWordbook,
  type StudyDashboard,
  type StudyRoundScope,
  type WordbookProgress,
} from '../data/workspaceApi'
import {
  DEFAULT_STUDY_PREFERENCES,
  readStudyPreferences,
  writeStudyPreferences,
  type DictationDisplayPreferences,
  type FlashcardDisplayPreferences,
  type StudyExerciseType,
  type StudyModeKey,
  type WordbookStudyPreferences,
} from '../data/studyPreferences'
import {
  readWordbookFilters,
  writeWordbookFilters,
  type WordbookSort,
} from '../data/wordbookFilters'
import {
  DEFAULT_STUDY_SHORTCUTS,
  normalizeShortcutKey,
  readStudyShortcuts,
  shortcutLabel,
  writeStudyShortcuts,
  type StudyShortcutAction,
  type StudyShortcutPreferences,
} from '../data/studyShortcuts'
import {
  readPronunciationPreferences,
  writePronunciationPreferences,
  type EnglishAccent,
  type PronunciationPreferences,
} from '../data/pronunciationPreferences'
import { wordbookCsvFilename, wordbookToCsv } from '../data/wordbookExport'
import { IMPORT_DRAFT_QUERY_PARAM } from '../data/importDraftStatus'
import { getStudyClientId } from '../data/studyApi'
import {
  invalidateWordbookStudyCache,
  readCachedWordbookDashboard,
  readCachedWordbookWords,
  writeCachedWordbookDashboard,
  writeCachedWordbookWords,
} from '../data/wordbookStudyCache'
import { useModalDialog } from '../hooks/useModalDialog'
import {
  DEFAULT_REVIEW_SCHEDULE,
  isDefaultReviewSchedule,
  isReviewDue,
  levelOf,
  parseReviewSchedule,
  reviewPriority,
  sameReviewSchedule,
  type ReviewSchedule,
  type ReviewScheduleEntry,
} from '../data/reviewSchedule'
import { dailyNewPlan, isDailyPlanComplete, remainingPlanWords, studyPlanActionLabel } from '../data/studyPlan'
import { firstAvailableMeaning } from '../domain/meaningSelection'
import type { WordbookItem } from '../domain/types'
import { useDictationSession } from '../features/dictation/useDictationSession'
import { SyncedFlashcardRound } from '../features/flashcards/SyncedFlashcardRound'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useAuth } from '../hooks/useAuth'
import { usePronounce } from '../hooks/usePronounce'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'

type StudyMode = StudyModeKey
type SettingsSection = 'plan' | 'pronunciation' | 'shortcuts' | StudyMode
type WorkspaceIconName = 'plus' | 'trash' | 'star' | 'edit' | 'book' | 'repeat' | 'headphones' | 'card' | 'settings' | 'chevron' | 'clock' | 'calendar' | 'fire' | 'dots'
type CoverTone = 'blue' | 'amber' | 'green' | 'lavender' | 'rose' | 'slate'
type WorkspaceBook = {
  id: string
  title: string
  description: string
  category?: string
  sourceCatalogId?: string
  sourceRevisionId?: string
  wordCount: number
  progress: WordbookProgress
  tone: CoverTone
  shortLabel: string
  createdAt: string
  updatedAt: string
  entries: WorkspaceEntry[]
  reviewSchedule: ReviewSchedule
  studyPreferences?: WordbookStudyPreferences
}
type WorkspaceEntry = WordbookItem & ReviewScheduleEntry & {
  levelReachedAt?: string
  recognitionStreak?: 0 | 1 | 2
}

type FullEntriesRequest = {
  generation: number
  promise: Promise<WorkspaceBook['entries']>
}

type RecentStudyRow = {
  id: string
  word: string
  pos: string
  definition: string
  result: string
  resultTone: 'done' | 'pending' | 'active'
  time: string
}

const WEEK_METRICS = [
  { key: 'new', label: '新词学习', className: 'blue' },
  { key: 'review', label: '复习巩固', className: 'orange' },
  { key: 'dictation', label: '听写训练', className: 'green' },
] as const

const WORD_LEVEL_STATS = [
  { level: 0, key: 'l0', label: '未学习' },
  { level: 1, key: 'l1', label: '初识' },
  { level: 2, key: 'l2', label: '熟悉' },
  { level: 3, key: 'l3', label: '掌握' },
  { level: 4, key: 'l4', label: '精通' },
] as const

function formatActivityTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

// 结果 column speaks the ladder's vocabulary: successful study shows the proficiency
// the word held right after that action (levelAfter), failures echo the miss itself.
const LEVEL_RESULT: Partial<Record<number, { result: string; resultTone: 'done' | 'pending' | 'active' }>> = {
  1: { result: '初识', resultTone: 'active' },
  2: { result: '熟悉', resultTone: 'active' },
  3: { result: '掌握', resultTone: 'done' },
  4: { result: '精通', resultTone: 'done' },
}

function activityResult(activity: StudyDashboard['recentActivity'][number]) {
  if (activity.kind === 'mark') return (activity.level ?? 0) >= 3
    ? { result: '已标熟', resultTone: 'done' as const }
    : { result: '已重置', resultTone: 'pending' as const }
  const failed = activity.kind === 'dictation' ? activity.correct === false : activity.verdict === 'unknown'
  if (failed) return activity.kind === 'dictation'
    ? { result: '听写错误', resultTone: 'pending' as const }
    : { result: '不熟', resultTone: 'pending' as const }
  if (activity.verdict === 'vague') return { result: '模糊', resultTone: 'pending' as const }
  const after = activity.levelAfter !== undefined ? LEVEL_RESULT[activity.levelAfter] : undefined
  if (after) return after
  // Payloads predating levelAfter fall back to an action echo.
  if (activity.kind === 'new') return { result: '已学习', resultTone: 'active' as const }
  if (activity.kind === 'flashcard') return { result: '认识', resultTone: 'active' as const }
  return { result: '听写正确', resultTone: 'done' as const }
}

function toRecentStudyRows(
  activities: StudyDashboard['recentActivity'],
  entriesByWord: ReadonlyMap<string, WordbookItem>,
  entriesLoaded: boolean,
): RecentStudyRow[] {
  return activities.slice(0, 5).map((activity) => {
    const entry = entriesByWord.get(activity.word)
    const meaning = entry ? firstAvailableMeaning(entry) : undefined
    return {
      id: activity.id,
      word: activity.word,
      pos: meaning?.pos || (entriesLoaded ? '—' : '待加载'),
      definition: meaning?.definition || (entriesLoaded ? '—' : '开始学习后显示释义'),
      ...activityResult(activity),
      time: formatActivityTime(activity.occurredAt),
    }
  })
}

type StudyEntryDerivation = {
  reviewDueEntries: WorkspaceEntry[]
  reviewAheadEntries: WorkspaceEntry[]
  reviewDueCount: number
  reviewAheadCount: number
  unstudiedEntries: WorkspaceEntry[]
  dictationEntries: WorkspaceEntry[]
}

function deriveStudyEntries(entries: WorkspaceEntry[], reviewSchedule: ReviewSchedule): StudyEntryDerivation {
  const reviewNow = new Date()
  const isReviewLevel = (entry: WorkspaceEntry) => levelOf(entry) > 0
  const byReviewPriority = (left: WorkspaceEntry, right: WorkspaceEntry) => reviewPriority(left, reviewSchedule) - reviewPriority(right, reviewSchedule)
  const reviewDueEntries = entries.filter((entry) => isReviewDue(entry, reviewNow, reviewSchedule)).sort(byReviewPriority)
  const reviewAheadEntries = entries.filter((entry) => isReviewLevel(entry) && !isReviewDue(entry, reviewNow, reviewSchedule)).sort(byReviewPriority)
  const dictationEntries = entries
    .filter((entry) => levelOf(entry) >= 2)
    .sort((left, right) => {
      const dueOrder = Number(isReviewDue(right, reviewNow, reviewSchedule)) - Number(isReviewDue(left, reviewNow, reviewSchedule))
      return dueOrder || reviewPriority(left, reviewSchedule) - reviewPriority(right, reviewSchedule)
    })
  return {
    reviewDueEntries,
    reviewAheadEntries,
    reviewDueCount: reviewDueEntries.length,
    reviewAheadCount: reviewAheadEntries.length,
    unstudiedEntries: entries.filter((entry) => levelOf(entry) === 0),
    dictationEntries,
  }
}

const EMPTY_WORKSPACE_ENTRIES: WorkspaceEntry[] = []
const EMPTY_STUDY_ENTRY_DERIVATION: StudyEntryDerivation = {
  reviewDueEntries: EMPTY_WORKSPACE_ENTRIES,
  reviewAheadEntries: EMPTY_WORKSPACE_ENTRIES,
  reviewDueCount: 0,
  reviewAheadCount: 0,
  unstudiedEntries: EMPTY_WORKSPACE_ENTRIES,
  dictationEntries: EMPTY_WORKSPACE_ENTRIES,
}

const FULL_ENTRIES_LOADING_NOTICE = '正在加载词条，请稍候。'
const STALE_FULL_ENTRIES_REQUEST = Symbol('stale-full-entries-request')

const WORKSPACE_ICON_PATHS: Record<WorkspaceIconName, ReactNode> = {
    plus: <path d="M12 5v14M5 12h14" />,
    trash: <><path d="M5.5 7.5h13M9.5 4.5h5M8 7.5l.7 11h5.6l.7-11" /><path d="M10.5 10.5v5M13.5 10.5v5" /></>,
    star: <path d="m12 4 2.2 4.45 4.9.7-3.55 3.45.84 4.88L12 15.2l-4.39 2.3.84-4.88L4.9 9.15l4.9-.7z" />,
    edit: <><path d="m5 16.8-.7 3.1 3.1-.7L18 8.6l-2.5-2.5z" /><path d="m13.9 5.2 2.5 2.5" /></>,
    book: <><path d="M4.5 5.5c3.2-1.2 5.8-.6 7.5 1.5v12c-1.7-2.1-4.3-2.7-7.5-1.5z" /><path d="M19.5 5.5c-3.2-1.2-5.8-.6-7.5 1.5v12c1.7-2.1 4.3-2.7 7.5-1.5z" /></>,
    repeat: <><path d="M18.5 8.5A7 7 0 0 0 6.1 7L4.5 9" /><path d="M4.5 5.5V9H8" /><path d="M5.5 15.5A7 7 0 0 0 17.9 17l1.6-2" /><path d="M19.5 18.5V15H16" /></>,
    headphones: <><path d="M4.5 13v-2a7.5 7.5 0 0 1 15 0v2" /><path d="M4.5 13h3v6h-1a2 2 0 0 1-2-2zm15 0h-3v6h1a2 2 0 0 0 2-2z" /></>,
    card: <><rect x="4" y="6" width="16" height="12" rx="2" /><path d="M4 9.5h16M8 14h3" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M12 3.8v2M12 18.2v2M20.2 12h-2M5.8 12h-2M17.8 6.2l-1.4 1.4M7.6 16.4l-1.4 1.4M17.8 17.8l-1.4-1.4M7.6 7.6 6.2 6.2" /></>,
    chevron: <path d="m9 5 6 7-6 7" />,
    clock: <><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></>,
    calendar: <><rect x="4.5" y="6" width="15" height="13" rx="2" /><path d="M8 4.5v3M16 4.5v3M4.5 10h15" /></>,
    fire: <path d="M13.2 3.8c.6 3-1.7 4.3-1.7 6.2 0 .8.5 1.4 1.3 1.4 1.6 0 2.2-2 1.8-3.6 2.5 1.7 3.6 4 3.1 6.8-.5 3.2-3.3 5.4-6.5 5.4-3.7 0-6.7-2.8-6.7-6.3 0-3.2 1.9-5.5 4.3-7.5.4 1.5 1.4 2.2 2.1 2.2 1.2 0 1.6-1.4 2.3-4.6Z" />,
    dots: <><circle cx="5" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="19" cy="12" r="1" fill="currentColor" /></>,
}

function WorkspaceIcon({ name }: { name: WorkspaceIconName }) {
  return <svg className="workspace-icon" viewBox="0 0 24 24" aria-hidden="true">{WORKSPACE_ICON_PATHS[name]}</svg>
}

function WorkspaceCover({ tone, label, small = false }: { tone: CoverTone; label: string; small?: boolean }) {
  return <div className={`workspace-cover cover-${tone} ${small ? 'small' : ''}`} aria-hidden="true"><span>{label}</span><i /></div>
}

function WorkspaceCatalogGroup({
  title,
  icon,
  collection,
  books,
}: {
  title: string
  icon: 'star' | 'book'
  collection: 'favorites' | 'uploads'
  books: CatalogWordbook[]
}) {
  return (
    <section className="workspace-catalog-group" aria-label={title}>
      <header>
        <h2><WorkspaceIcon name={icon} />{title}</h2>
        <Link to={`/marketplace?collection=${collection}`}>全部</Link>
      </header>
      {books.length ? (
        <div>
          {books.slice(0, 3).map((book) => (
            <Link key={book.id} to={`/marketplace?collection=${collection}&focus=${encodeURIComponent(book.id)}`}>
              <span><strong>{book.title}</strong><small>{book.wordCount} 词 · {book.author}</small></span>
              <WorkspaceIcon name="chevron" />
            </Link>
          ))}
        </div>
      ) : <p>{collection === 'favorites' ? '暂无收藏' : '暂无上传'}</p>}
    </section>
  )
}

function remoteToWorkspaceBook(book: MyWordbook, index: number): WorkspaceBook {
  const tones: CoverTone[] = ['blue', 'slate', 'rose', 'amber', 'green', 'lavender']
  return {
    id: book.id,
    title: book.title,
    description: book.description,
    category: book.category,
    sourceCatalogId: book.sourceCatalogId,
    sourceRevisionId: book.sourceRevisionId,
    wordCount: book.wordCount,
    progress: book.progress,
    tone: tones[index % tones.length],
    shortLabel: book.title.slice(0, 12),
    createdAt: book.createdAt,
    updatedAt: book.updatedAt,
    entries: [],
    reviewSchedule: book.reviewSchedule,
    studyPreferences: book.studyPreferences,
  }
}

export function WordbookPage() {
  useDocumentTitle('我的单词本')
  const [searchParams, setSearchParams] = useSearchParams()
  const resumeImportDraftId = searchParams.get(IMPORT_DRAFT_QUERY_PARAM)?.trim() || undefined
  const { user, loading: authLoading } = useAuth()
  const [books, setBooks] = useState<WorkspaceBook[]>([])
  const [favoriteCatalog, setFavoriteCatalog] = useState<CatalogWordbook[]>([])
  const [uploadCatalog, setUploadCatalog] = useState<CatalogWordbook[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [remoteTrash, setRemoteTrash] = useState<WorkspaceBook[]>([])
  const [showRecycle, setShowRecycle] = useState(false)
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const api = getWorkspaceApi()
  const [cacheClientId] = useState(() => getStudyClientId())
  const [dashboard, setDashboard] = useState<StudyDashboard | null>(null)
  const [remoteEntries, setRemoteEntries] = useState<WorkspaceBook['entries'] | null>(null)
  const [fullEntriesLoading, setFullEntriesLoading] = useState(false)
  const [dashboardLoading, setDashboardLoading] = useState(false)
  const [studyMode, setStudyMode] = useState<StudyMode | null>(null)
  // New learning and review can both switch from the daily deck to a voluntary ahead deck.
  const [studyScope, setStudyScope] = useState<StudyRoundScope>('standard')
  const [settingsSection, setSettingsSection] = useState<SettingsSection | null>(null)
  const [showImporter, setShowImporter] = useState(false)
  const [importTargetId, setImportTargetId] = useState<string | undefined>()
  const [recycleCandidate, setRecycleCandidate] = useState<WorkspaceBook | null>(null)
  const [showWordManager, setShowWordManager] = useState(false)
  const [wordManagerLevel, setWordManagerLevel] = useState<WordManagerLevelFilter>('all')
  const [contributionBookId, setContributionBookId] = useState<string | null>(null)
  const [wordSaving, setWordSaving] = useState(false)
  const [bookQuery, setBookQuery] = useState(() => readWordbookFilters().query)
  const [bookCategory, setBookCategory] = useState(() => readWordbookFilters().category)
  const [bookSort, setBookSort] = useState<WordbookSort>(() => readWordbookFilters().sort)
  const [compactBookLayout, setCompactBookLayout] = useState(() => (
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(max-width: 640px)').matches
      : false
  ))
  const [booksExpanded, setBooksExpanded] = useState(false)
  const [categoryDraft, setCategoryDraft] = useState('')
  const [categoryEditing, setCategoryEditing] = useState(false)
  const [categorySaving, setCategorySaving] = useState(false)
  const categoryInputRef = useRef<HTMLInputElement>(null)
  const workspaceMainRef = useRef<HTMLDivElement>(null)
  const workspaceTitleRef = useRef<HTMLHeadingElement>(null)
  const [preferences, setPreferences] = useState<WordbookStudyPreferences>(
    () => structuredClone(DEFAULT_STUDY_PREFERENCES),
  )
  const [shortcuts, setShortcuts] = useState<StudyShortcutPreferences>(() => readStudyShortcuts())
  const [pronunciationPreferences, setPronunciationPreferences] = useState<PronunciationPreferences>(
    () => readPronunciationPreferences(),
  )
  const dashboardRequest = useRef(0)
  const loadedEntriesWordbookId = useRef<string | null>(null)
  const remoteEntriesRef = useRef<WorkspaceBook['entries'] | null>(null)
  const fullEntriesRequests = useRef(new Map<string, FullEntriesRequest>())
  const fullEntriesGeneration = useRef(new Map<string, number>())
  const selectedBookIdRef = useRef('')
  const studyReturnFocusRef = useRef<HTMLElement | null>(null)
  const wordManagerReturnFocusRef = useRef<HTMLElement | null>(null)
  const studyProgressCommittedRef = useRef(false)
  remoteEntriesRef.current = remoteEntries
  const studyRefreshTimer = useRef<number | null>(null)
  const recycleDialogRef = useModalDialog<HTMLElement>({
    open: recycleCandidate !== null,
    onClose: () => setRecycleCandidate(null),
  })

  useEffect(() => {
    if (!resumeImportDraftId) return
    setImportTargetId(undefined)
    setShowImporter(true)
  }, [resumeImportDraftId])

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(max-width: 640px)')
    const syncLayout = () => setCompactBookLayout(media.matches)
    syncLayout()
    media.addEventListener('change', syncLayout)
    return () => media.removeEventListener('change', syncLayout)
  }, [])
  const preferenceSaveQueue = useRef<Promise<void>>(Promise.resolve())
  const globalSettingsSaveQueue = useRef<Promise<void>>(Promise.resolve())
  const globalSettingsGeneration = useRef(0)
  const categories = useMemo(() => [...new Set(books.map((book) => book.category).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, 'zh-CN')), [books])
  const filteredBooks = useMemo(() => {
    const query = bookQuery.trim().toLocaleLowerCase()
    return books
      .filter((book) => !query || `${book.title} ${book.description}`.toLocaleLowerCase().includes(query))
      .filter((book) => bookCategory === '全部' || (bookCategory === '未分类' ? !book.category : book.category === bookCategory))
      .sort((left, right) => {
        if (bookSort === 'name') return left.title.localeCompare(right.title, 'zh-CN')
        if (bookSort === 'count') return right.wordCount - left.wordCount
        if (bookSort === 'progress') return right.progress.percent - left.progress.percent
        return right.updatedAt.localeCompare(left.updatedAt)
      })
  }, [bookCategory, bookQuery, bookSort, books])
  const selectedBook = filteredBooks.find((book) => book.id === selectedId) ?? filteredBooks[0]
  selectedBookIdRef.current = selectedBook?.id ?? ''
  const activeEntries = selectedBook && loadedEntriesWordbookId.current === selectedBook.id && remoteEntries !== null
    ? remoteEntries
    : EMPTY_WORKSPACE_ENTRIES
  const studyEntryDerivation = useMemo(
    () => selectedBook
      ? deriveStudyEntries(activeEntries, selectedBook.reviewSchedule)
      : EMPTY_STUDY_ENTRY_DERIVATION,
    [activeEntries, selectedBook?.id, selectedBook?.reviewSchedule],
  )

  const syncBookPreferences = useCallback((
    wordbookId: string,
    next: WordbookStudyPreferences,
    reportFailure = true,
  ) => {
    if (!api) return
    preferenceSaveQueue.current = preferenceSaveQueue.current
      .then(async () => {
        const updated = await api.updateMyWordbook(wordbookId, { studyPreferences: next })
        const synced = updated.studyPreferences ?? next
        writeStudyPreferences(wordbookId, synced)
        setBooks((current) => current.map((book) => book.id === wordbookId
          ? { ...book, updatedAt: updated.updatedAt, studyPreferences: synced }
          : book))
      })
      .catch(() => {
        if (reportFailure) setNotice('设置已保存在本机，但多端同步失败，请稍后重试。')
      })
  }, [api])

  const syncGlobalSettings = useCallback((
    input: { shortcuts?: StudyShortcutPreferences; pronunciation?: PronunciationPreferences },
    reportFailure = true,
  ) => {
    if (!api) return
    globalSettingsSaveQueue.current = globalSettingsSaveQueue.current
      .then(async () => {
        await api.updateStudySettings(input)
      })
      .catch(() => {
        if (reportFailure) setNotice('设置已保存在本机，但多端同步失败，请稍后重试。')
      })
  }, [api])

  useEffect(() => {
    writeWordbookFilters({ query: bookQuery, category: bookCategory, sort: bookSort })
  }, [bookCategory, bookQuery, bookSort])

  useEffect(() => {
    if (!api) return
    let active = true
    const generation = globalSettingsGeneration.current
    void api.getStudySettings()
      .then(({ settings }) => {
        if (!active) return
        if (!settings) {
          // The server has no settings yet: migrate this browser's existing local
          // values. Reading now (instead of at effect start) includes any quick edit.
          syncGlobalSettings({
            shortcuts: readStudyShortcuts(),
            pronunciation: readPronunciationPreferences(),
          }, false)
          return
        }
        // Do not let a slow initial GET undo a setting the user just changed.
        if (globalSettingsGeneration.current !== generation) return
        setShortcuts(writeStudyShortcuts(settings.shortcuts))
        setPronunciationPreferences(writePronunciationPreferences(settings.pronunciation))
      })
      .catch(() => {
        // Local values remain active while the service is offline or rolling out.
      })
    return () => {
      active = false
    }
  }, [api, syncGlobalSettings])

  useEffect(() => {
    if (
      loading
      || bookCategory === '全部'
      || bookCategory === '未分类'
      || categories.includes(bookCategory)
    ) return
    setBookCategory('全部')
  }, [bookCategory, categories, loading])

  const refreshMyWordbooks = useCallback(async (preferId?: string) => {
    if (!api) {
      setBooks([])
      setLoading(false)
      setNotice('未配置后端地址，无法读取单词本。')
      return false
    }
    try {
      // The book cards are the critical path. Community feeds are useful
      // sidebar context, but must not hold the whole workspace behind their
      // network latency.
      const remote = await api.listMyWordbooks()
      const mapped = remote.map(remoteToWorkspaceBook)
      setBooks(mapped)
      setSelectedId((current) => preferId ?? (mapped.some((book) => book.id === current) ? current : mapped[0]?.id ?? ''))
      setNotice('')
      setLoading(false)
      void api.listFavorites().then(setFavoriteCatalog).catch(() => undefined)
      void api.listUploads().then(setUploadCatalog).catch(() => undefined)
      return true
    } catch {
      setNotice('单词本加载失败，请确认后端服务可用后重试。')
      return false
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => { void refreshMyWordbooks() }, [refreshMyWordbooks])

  const invalidateFullEntries = useCallback((wordbookId: string, clearVisible = true) => {
    fullEntriesGeneration.current.set(wordbookId, (fullEntriesGeneration.current.get(wordbookId) ?? 0) + 1)
    invalidateWordbookStudyCache(cacheClientId, wordbookId, undefined, { words: true })
    if (clearVisible && selectedBookIdRef.current === wordbookId) {
      setRemoteEntries(null)
      loadedEntriesWordbookId.current = null
    }
  }, [cacheClientId])

  const ensureFullEntries = useCallback(async (
    requestedWordbookId?: string,
    force = false,
  ): Promise<WorkspaceBook['entries'] | null> => {
    const wordbookId = requestedWordbookId ?? selectedBook?.id
    if (!api || !wordbookId) {
      if (!api) setNotice('未配置后端地址，无法读取单词本。')
      return null
    }

    if (!force && loadedEntriesWordbookId.current === wordbookId && remoteEntriesRef.current !== null) {
      return remoteEntriesRef.current
    }
    if (!force) {
      const cachedWords = readCachedWordbookWords(cacheClientId, wordbookId)
      if (cachedWords) {
        if (selectedBookIdRef.current === wordbookId) {
          setRemoteEntries(cachedWords)
          loadedEntriesWordbookId.current = wordbookId
        }
        return cachedWords
      }
    }

    const generation = fullEntriesGeneration.current.get(wordbookId) ?? 0
    const existingRequest = fullEntriesRequests.current.get(wordbookId)
    if (existingRequest) {
      if (!force && existingRequest.generation === generation) return existingRequest.promise
      try {
        await existingRequest.promise
      } catch {
        // A superseded request is expected to reject. Wait for it to leave the
        // request map before starting the fresh forced/generation-aware load.
      }
      return ensureFullEntries(wordbookId, force)
    }

    setFullEntriesLoading(true)
    setNotice(FULL_ENTRIES_LOADING_NOTICE)
    let request: Promise<WorkspaceBook['entries']>
    request = api.listWords(wordbookId)
      .then((words) => {
        if ((fullEntriesGeneration.current.get(wordbookId) ?? 0) !== generation) {
          throw STALE_FULL_ENTRIES_REQUEST
        }
        writeCachedWordbookWords(cacheClientId, wordbookId, words)
        // A user can switch books while a large response is in flight. Keep
        // the cache warm, but never put that stale response in the visible book.
        if (selectedBookIdRef.current === wordbookId) {
          setRemoteEntries(words)
          loadedEntriesWordbookId.current = wordbookId
          setNotice((current) => current === FULL_ENTRIES_LOADING_NOTICE ? '' : current)
        }
        return words
      })
      .catch((error) => {
        if (error !== STALE_FULL_ENTRIES_REQUEST && selectedBookIdRef.current === wordbookId) {
          setNotice('词条加载失败，请稍后重试。')
        }
        throw error
      })
      .finally(() => {
        if (fullEntriesRequests.current.get(wordbookId)?.promise === request) {
          fullEntriesRequests.current.delete(wordbookId)
        }
        setFullEntriesLoading(fullEntriesRequests.current.size > 0)
        if (!fullEntriesRequests.current.has(selectedBookIdRef.current)) {
          setNotice((current) => current === FULL_ENTRIES_LOADING_NOTICE ? '' : current)
        }
      })
    fullEntriesRequests.current.set(wordbookId, { generation, promise: request })
    return request
  }, [api, cacheClientId, selectedBook?.id])

  const refreshSelectedBook = useCallback(async (
    requestedWordbookId?: string,
    refresh: 'cached' | 'dashboard' | 'all' = 'cached',
  ) => {
    const requestId = ++dashboardRequest.current
    const wordbookId = requestedWordbookId ?? selectedBook?.id
    if (!api || !wordbookId) {
      setDashboard(null)
      setRemoteEntries(null)
      loadedEntriesWordbookId.current = null
      setDashboardLoading(false)
      return false
    }

    const forceDashboard = refresh === 'dashboard' || refresh === 'all'
    const forceWords = refresh === 'all'
    if (forceDashboard) invalidateWordbookStudyCache(cacheClientId, wordbookId, undefined, { dashboard: true })
    if (forceWords) invalidateFullEntries(wordbookId, loadedEntriesWordbookId.current !== wordbookId)
    const cachedDashboard = forceDashboard ? null : readCachedWordbookDashboard(cacheClientId, wordbookId)

    // Switch all four dashboard-backed cards as one snapshot. A cache hit never
    // falls through to a loading placeholder, while a miss cannot flash another book.
    setDashboard((current) => cachedDashboard ?? (current?.wordbook.id === wordbookId ? current : null))
    setDashboardLoading(!cachedDashboard)
    if (selectedBookIdRef.current === wordbookId && loadedEntriesWordbookId.current !== wordbookId) {
      setRemoteEntries(null)
      loadedEntriesWordbookId.current = null
    }
    if (!fullEntriesRequests.current.has(wordbookId)) {
      setNotice((current) => current === FULL_ENTRIES_LOADING_NOTICE ? '' : current)
    }

    let dashboardSynced = Boolean(cachedDashboard)
    let wordsSynced = !forceWords
    let dashboardFailed = false
    let wordsFailed = false

    const dashboardTask = cachedDashboard
      ? Promise.resolve()
      : api.getDashboard(wordbookId)
          .then((nextDashboard) => {
            if (dashboardRequest.current !== requestId) return
            writeCachedWordbookDashboard(cacheClientId, wordbookId, nextDashboard)
            setDashboard(nextDashboard)
            dashboardSynced = true
          })
          .catch(() => { dashboardFailed = true })
          .finally(() => {
            if (dashboardRequest.current === requestId) setDashboardLoading(false)
          })

    // Full words are loaded only by an explicit action (or an explicit full
    // refresh after a mutation). The initial route therefore needs only the
    // compact dashboard request above.
    const wordsTask = forceWords
      ? ensureFullEntries(wordbookId, true)
          .then(() => { wordsSynced = true })
          .catch(() => { wordsFailed = true })
      : Promise.resolve()

    await Promise.all([dashboardTask, wordsTask])
    if (dashboardRequest.current !== requestId) return false
    if (dashboardFailed || wordsFailed) {
      setNotice(dashboardFailed && wordsFailed
        ? '词本详情加载失败，请稍后重试。'
        : dashboardFailed
          ? '学习数据加载失败，词条仍可使用。'
          : '词条加载失败，学习数据已恢复。')
    }
    return dashboardSynced && wordsSynced
  }, [api, cacheClientId, ensureFullEntries, invalidateFullEntries, selectedBook?.id])

  useEffect(() => { void refreshSelectedBook() }, [refreshSelectedBook])

  const scheduleStudyProgressRefresh = useCallback(() => {
    const wordbookId = selectedBook?.id
    if (!wordbookId) return
    studyProgressCommittedRef.current = true
    if (studyRefreshTimer.current !== null) window.clearTimeout(studyRefreshTimer.current)
    studyRefreshTimer.current = window.setTimeout(() => {
      studyRefreshTimer.current = null
      void refreshSelectedBook(wordbookId, 'dashboard')
    }, 120)
  }, [refreshSelectedBook, selectedBook?.id])

  useEffect(() => () => {
    if (studyRefreshTimer.current !== null) {
      window.clearTimeout(studyRefreshTimer.current)
      studyRefreshTimer.current = null
    }
  }, [selectedBook?.id])

  useEffect(() => {
    if (!selectedBook) return
    setCategoryDraft(selectedBook.category ?? '')
    setCategoryEditing(false)
    const resolvedPreferences = selectedBook.studyPreferences ?? readStudyPreferences(selectedBook.id)
    setPreferences(resolvedPreferences)
    writeStudyPreferences(selectedBook.id, resolvedPreferences)
    if (!selectedBook.studyPreferences) {
      // Legacy browsers kept this value only in localStorage. Seed the remote copy
      // once, then all devices will receive it with the wordbook card.
      syncBookPreferences(selectedBook.id, resolvedPreferences, false)
    }
    setStudyMode(null)
    setStudyScope('standard')
    setSettingsSection(null)
  }, [selectedBook?.id, syncBookPreferences])

  useEffect(() => {
    if (!categoryEditing) return
    categoryInputRef.current?.focus()
    categoryInputRef.current?.select()
  }, [categoryEditing])

  async function saveCategory() {
    if (!api || !selectedBook || categorySaving) return
    const category = categoryDraft.trim()
    if (category.length > 30) { setNotice('分类名称最多 30 个字符。'); return }
    setCategorySaving(true)
    try {
      await api.updateMyWordbook(selectedBook.id, { category: category || null })
      await refreshMyWordbooks(selectedBook.id)
      setCategoryDraft(category)
      setCategoryEditing(false)
      setNotice(category ? `已归入「${category}」。` : '已设为未分类。')
    } catch {
      setNotice('分类保存失败，请稍后重试。')
    } finally {
      setCategorySaving(false)
    }
  }

  function toggleCategoryEditing() {
    if (categoryEditing) {
      void saveCategory()
      return
    }
    setCategoryEditing(true)
  }

  async function exitStudy() {
    const returnFocus = studyReturnFocusRef.current
    const finishedMode = studyMode
    const wordbookId = selectedBook.id
    const progressCommitted = studyProgressCommittedRef.current
    studyProgressCommittedRef.current = false
    if (studyRefreshTimer.current !== null) {
      window.clearTimeout(studyRefreshTimer.current)
      studyRefreshTimer.current = null
    }
    setStudyMode(null)
    if (progressCommitted && finishedMode !== 'dictation') invalidateFullEntries(wordbookId)
    await Promise.all([
      refreshMyWordbooks(wordbookId),
      refreshSelectedBook(wordbookId, finishedMode === 'dictation' ? 'all' : 'dashboard'),
    ])
    // A post-session refresh can temporarily disable the initiating action.
    // Restore focus only after the relevant compact/full refresh has committed.
    if (studyReturnFocusRef.current !== returnFocus) return
    window.requestAnimationFrame(() => {
      if (studyReturnFocusRef.current !== returnFocus) return
      studyReturnFocusRef.current = null
      if (returnFocus?.isConnected) returnFocus.focus()
    })
  }

  function savePreferences(next: WordbookStudyPreferences) {
    if (!selectedBook) return
    setPreferences(next)
    writeStudyPreferences(selectedBook.id, next)
    syncBookPreferences(selectedBook.id, next)
  }

  async function saveReviewSchedule(next: ReviewSchedule): Promise<boolean> {
    if (!api || !selectedBook) return false
    try {
      await api.updateMyWordbook(selectedBook.id, { reviewSchedule: next })
      invalidateFullEntries(selectedBook.id)
      await refreshMyWordbooks(selectedBook.id)
      await refreshSelectedBook(undefined, 'dashboard')
      setNotice(isDefaultReviewSchedule(next) ? '已恢复默认遗忘曲线。' : '自定义复习方案已保存。')
      return true
    } catch {
      setNotice('复习方案保存失败，请稍后重试。')
      return false
    }
  }

  function saveShortcuts(next: StudyShortcutPreferences) {
    const normalized = writeStudyShortcuts(next)
    globalSettingsGeneration.current += 1
    setShortcuts(normalized)
    syncGlobalSettings({ shortcuts: normalized })
  }

  function savePronunciationPreferences(next: PronunciationPreferences) {
    const normalized = writePronunciationPreferences(next)
    globalSettingsGeneration.current += 1
    setPronunciationPreferences(normalized)
    syncGlobalSettings({ pronunciation: normalized })
  }

  function createBook() {
    setImportTargetId(undefined)
    setShowImporter(true)
  }

  function closeImporter() {
    setShowImporter(false)
    setImportTargetId(undefined)
    if (!resumeImportDraftId) return
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.delete(IMPORT_DRAFT_QUERY_PARAM)
      return next
    }, { replace: true })
  }

  async function importBookFile() {
    if (!selectedBook) return
    const wordbookId = selectedBook.id
    let entries: WorkspaceBook['entries'] | null
    try {
      entries = await ensureFullEntries(wordbookId)
    } catch {
      return
    }
    if (!entries || selectedBookIdRef.current !== wordbookId) return
    setImportTargetId(selectedBook.id)
    setShowImporter(true)
  }

  async function exportBookFile() {
    if (!selectedBook) return
    const wordbookId = selectedBook.id
    let entries: WorkspaceBook['entries'] | null
    try {
      entries = await ensureFullEntries(wordbookId)
    } catch {
      return
    }
    if (!entries || selectedBookIdRef.current !== wordbookId) return
    const blob = new Blob([wordbookToCsv(entries)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    try {
      link.href = url
      link.download = wordbookCsvFilename(selectedBook.title)
      document.body.append(link)
      link.click()
      setNotice(`已导出「${selectedBook.title}」的 CSV。编辑后可通过“导入文件”的覆盖模式写回。`)
    } finally {
      link.remove()
      URL.revokeObjectURL(url)
    }
  }

  async function finishImport(created: MyWordbook) {
    const existed = books.some((book) => book.id === created.id)
    selectedBookIdRef.current = created.id
    const [listSynced, detailSynced] = await Promise.all([
      refreshMyWordbooks(created.id),
      refreshSelectedBook(created.id, 'all'),
    ])
    setNotice(listSynced && detailSynced
      ? existed ? `已更新「${created.title}」。` : `已创建「${created.title}」。`
      : `已保存「${created.title}」，部分统计同步失败，请稍后重试。`)
  }

  async function saveManagedWord(id: string, patch: WordbookWordPatch) {
    if (!api || !selectedBook) return
    setWordSaving(true)
    try {
      await api.updateWord(selectedBook.id, id, patch)
      invalidateFullEntries(selectedBook.id)
      await refreshSelectedBook(undefined, 'dashboard')
      await refreshMyWordbooks(selectedBook.id)
      setNotice(`已更新「${patch.word}」，未重新处理其他词条。`)
    } finally {
      setWordSaving(false)
    }
  }

  async function markManagedWordKnown(_id: string, word: string) {
    if (!api || !selectedBook) return
    setWordSaving(true)
    try {
      await api.recordStudyEvent({ kind: 'mark', word, wordbookId: selectedBook.id, level: 4 })
      invalidateFullEntries(selectedBook.id)
      await refreshSelectedBook(undefined, 'dashboard')
      await refreshMyWordbooks(selectedBook.id)
      setNotice(`已把「${word}」标为精通。`)
    } finally {
      setWordSaving(false)
    }
  }

  async function batchManagedWords(action: BatchWordAction, ids: string[]): Promise<BatchWordResult> {
    if (!api || !selectedBook) throw new Error('Workspace API unavailable')
    const result = await api.batchWords(selectedBook.id, action, ids)
    invalidateFullEntries(selectedBook.id)
    const [detailsSynced, listSynced] = await Promise.all([
      refreshSelectedBook(selectedBook.id, 'dashboard'),
      refreshMyWordbooks(selectedBook.id),
    ])
    const label = action === 'refresh-meanings' ? '释义更新' : action === 'mark-mastered' ? '批量标熟' : '批量删除'
    setNotice(detailsSynced && listSynced
      ? `${label}完成：成功 ${result.succeededIds.length} 个${result.failed.length ? `，失败 ${result.failed.length} 个` : ''}。`
      : `${label}已完成，但最新统计同步失败，请稍后重试。`)
    return result
  }

  function moveToRecycle(id: string) {
    setRecycleCandidate(books.find((item) => item.id === id) ?? null)
  }

  async function confirmMoveToRecycle() {
    const book = recycleCandidate
    if (!book) return
    if (!api) return
    try {
      await api.deleteMyWordbook(book.id)
      invalidateWordbookStudyCache(cacheClientId, book.id)
      setRecycleCandidate(null)
      await refreshMyWordbooks()
      setNotice('')
    } catch {
      setNotice('删除失败，当前词本未发生变化。')
    }
  }

  async function toggleRecycle() {
    const next = !showRecycle
    setShowRecycle(next)
    if (!api || !next) return
    try {
      setRemoteTrash((await api.listMyWordbooks(true)).map(remoteToWorkspaceBook))
    } catch {
      setNotice('回收站加载失败，请稍后重试。')
    }
  }

  async function restoreBook(book: WorkspaceBook) {
    if (!api) return
    try {
      await api.restoreMyWordbook(book.id)
      invalidateWordbookStudyCache(cacheClientId, book.id)
      setRemoteTrash((items) => items.filter((item) => item.id !== book.id))
      await refreshMyWordbooks(book.id)
      setNotice('')
    } catch {
      setNotice('恢复失败，请稍后重试。')
    }
  }

  async function purgeBook(book: WorkspaceBook) {
    if (!api) return
    if (!window.confirm(`彻底删除「${book.title}」？词本和它的学习记录将无法恢复。`)) return
    try {
      await api.purgeMyWordbook(book.id)
      invalidateWordbookStudyCache(cacheClientId, book.id)
      setRemoteTrash((items) => items.filter((item) => item.id !== book.id))
      setNotice('词本已彻底删除。')
    } catch {
      setNotice('彻底删除失败，请稍后重试。')
    }
  }

  function selectWorkspaceBook(id: string) {
    setSelectedId(id)
    if (!compactBookLayout) return
    setBooksExpanded(false)
    window.requestAnimationFrame(() => {
      workspaceMainRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
      workspaceTitleRef.current?.focus({ preventScroll: true })
    })
  }

  const bookPickerOpen = !compactBookLayout || booksExpanded

  const workspaceSidebar = (
    <aside className="workspace-sidebar" aria-label="我的词库">
      <button type="button" className="workspace-create" onClick={createBook}><WorkspaceIcon name="plus" />创建单词本</button>
      <div className="workspace-sidebar-heading">
        <h2>学习词本 <span>{filteredBooks.length}</span></h2>
        <button type="button" aria-expanded={bookPickerOpen} aria-controls="workspace-book-picker" onClick={() => setBooksExpanded((expanded) => !expanded)}>
          {booksExpanded ? '收起列表' : '更换词本'}
          <span aria-hidden="true">⌄</span>
        </button>
      </div>
      <div id="workspace-book-picker" className="workspace-book-picker" hidden={!bookPickerOpen}>
        <div className="workspace-book-tools">
          <input aria-label="搜索单词本" value={bookQuery} onChange={(event) => setBookQuery(event.target.value)} placeholder="搜索名称或说明" />
          <div>
            <select aria-label="按分类筛选" value={bookCategory} onChange={(event) => setBookCategory(event.target.value)}>
              <option>全部</option><option>未分类</option>{categories.map((category) => <option key={category}>{category}</option>)}
            </select>
            <select aria-label="单词本排序" value={bookSort} onChange={(event) => setBookSort(event.target.value as typeof bookSort)}>
              <option value="updated">最近更新</option><option value="name">名称</option><option value="count">单词数</option><option value="progress">学习进度</option>
            </select>
          </div>
        </div>
        <div className="workspace-book-list">{filteredBooks.map((book) => <button key={book.id} type="button" className={book.id === selectedBook?.id ? 'selected' : ''} onClick={() => selectWorkspaceBook(book.id)}><WorkspaceCover tone={book.tone} label={book.shortLabel} small /><span><strong>{book.title}</strong><small>{book.category ?? '未分类'} · {book.wordCount} 词</small></span></button>)}</div>
        {!filteredBooks.length && <div className="workspace-filter-empty"><p>没有匹配的单词本</p><button type="button" onClick={() => { setBookQuery(''); setBookCategory('全部') }}>清除筛选</button></div>}
      </div>
      <WorkspaceCatalogGroup title="广场收藏" icon="star" collection="favorites" books={favoriteCatalog} />
      <WorkspaceCatalogGroup title="我的上传" icon="book" collection="uploads" books={uploadCatalog} />
      <button type="button" className="workspace-recycle" onClick={() => void toggleRecycle()}><WorkspaceIcon name="trash" />回收站{remoteTrash.length ? ` (${remoteTrash.length})` : ''}</button>
      {showRecycle && <div className="recycle-panel"><p>回收站</p>{remoteTrash.length ? remoteTrash.map((book) => <div className="recycle-item" key={book.id}><strong title={book.title}>{book.title}</strong><span><button type="button" onClick={() => void restoreBook(book)}>恢复</button><button type="button" className="recycle-purge" onClick={() => void purgeBook(book)}>彻底删除</button></span></div>) : <small>暂无回收内容</small>}</div>}
    </aside>
  )

  if (loading) {
    return <section className="workspace-empty-page" aria-labelledby="workspace-loading-title"><h1 id="workspace-loading-title" className="workspace-visually-hidden">我的单词本</h1><EmptyState title="正在加载单词本" body="正在从后端读取你的词本与学习数据。" /></section>
  }

  if (!selectedBook) {
    return <>
      <section className="workspace-page workspace-page-empty" aria-labelledby="workspace-empty-title">
        <h1 id="workspace-empty-title" className="workspace-visually-hidden">我的单词本</h1>
        {workspaceSidebar}
        <div ref={workspaceMainRef} className="workspace-main"><section className="workspace-empty-page"><EmptyState title="还没有可用的学习词本" body={notice || '你仍可浏览左侧收藏和上传；选择“加入词本”后即可开始学习。'} action={<Button onClick={createBook}>创建单词本</Button>} /></section></div>
      </section>
      <ImportWordbookDialog
        key="wordbook-importer"
        open={showImporter}
        api={api}
        onClose={closeImporter}
        onCreated={(created) => { void finishImport(created) }}
        initialDraftId={resumeImportDraftId}
      />
    </>
  }

  const activeBook = { ...selectedBook, entries: activeEntries }
  const currentDashboard = dashboard?.wordbook.id === selectedBook.id ? dashboard : null
  const progress = currentDashboard?.wordbook.progress ?? selectedBook.progress
  const wordCount = currentDashboard?.wordbook.wordCount ?? selectedBook.wordCount
  const wordLevelTotal = WORD_LEVEL_STATS.reduce((total, stat) => total + progress.levels[stat.key], 0)
  const wordLevelStatistics = WORD_LEVEL_STATS.map((stat) => {
    const count = progress.levels[stat.key]
    return { ...stat, count, share: wordLevelTotal ? Math.round(count / wordLevelTotal * 100) : 0 }
  })
  const completedNew = currentDashboard?.todayPlan.new.completed ?? 0
  const completedReview = currentDashboard?.todayPlan.review.completed ?? 0
  const completedDictation = currentDashboard?.todayPlan.dictation.completed ?? 0
  // 听写训练 draws from L2+ only (must be 熟悉 before spelling), matching its deck
  // and the backend's dictationAvailable = l2 + l3 + l4.
  const dictationEligibleCount = progress.levels.l2 + progress.levels.l3 + progress.levels.l4
  // Adaptive review includes every learned rung, orders the most overdue first, and keeps
  // not-yet-due words in the optional 提前复习 deck.
  const reviewSchedule = activeBook.reviewSchedule
  const {
    reviewDueEntries,
    reviewAheadEntries,
    reviewDueCount,
    reviewAheadCount,
    unstudiedEntries,
    dictationEntries,
  } = studyEntryDerivation
  const entriesLoaded = remoteEntries !== null && loadedEntriesWordbookId.current === selectedBook.id
  const newPlan = dailyNewPlan(preferences.plan.newWords, completedNew, progress.unstudied)
  const reviewBreakdown = currentDashboard?.reviewBreakdown
  const learnedWordCount = progress.levels.l1 + progress.levels.l2 + progress.levels.l3 + progress.levels.l4
  const legacyReviewRemaining = currentDashboard
    ? Math.max(0, currentDashboard.todayPlan.review.target - currentDashboard.todayPlan.review.completed)
    : 0
  const scheduledReviewCount = reviewBreakdown?.scheduled ?? (entriesLoaded ? reviewDueCount : legacyReviewRemaining)
  const dashboardReviewDueCount = reviewBreakdown
    ? reviewBreakdown.protected + reviewBreakdown.regular + reviewBreakdown.backlog
    : legacyReviewRemaining
  const reviewAheadAvailable = entriesLoaded
    ? reviewAheadCount
    : Math.max(0, learnedWordCount - dashboardReviewDueCount)
  const backlogCount = reviewBreakdown?.backlog ?? 0
  const activeRound = (mode: 'new' | 'review', scope: StudyRoundScope = 'standard') =>
    currentDashboard?.activeRounds?.find((round) => round.mode === mode && round.scope === scope)
  const activeNewRound = activeRound('new')
  const activeAheadNew = activeRound('new', 'ahead')
  const activeStandardReview = activeRound('review')
  const activeBacklogReview = activeRound('review', 'backlog')
  const activeAheadReview = activeRound('review', 'ahead')
  const planCounts = {
    new: currentDashboard?.todayPlan.new.target ?? newPlan.target,
    review: currentDashboard?.todayPlan.review.target ?? scheduledReviewCount + completedReview,
    dictation: currentDashboard?.todayPlan.dictation.target
      ?? Math.min(preferences.plan.dictation, Math.max(completedDictation, dictationEligibleCount)),
  }
  const newPlanComplete = isDailyPlanComplete(planCounts.new, completedNew)
  const reviewPlanComplete = isDailyPlanComplete(planCounts.review, completedReview)
  // Due L3 words are prioritized by the dictation deck; a mature successful check promotes them.
  const finalCheckDue = currentDashboard?.finalCheckDue ?? 0
  const dictationDetail = finalCheckDue > 0
    ? `听音拼写，检测掌握 · ${finalCheckDue} 词到期可冲刺精通`
    : '听音拼写，检测掌握'
  const timelyReviewCount = reviewBreakdown
    ? reviewBreakdown.protected + reviewBreakdown.regular
    : reviewDueCount
  const reviewDetail = [isDefaultReviewSchedule(reviewSchedule) ? '分层遗忘曲线' : '自定义分层曲线']
    .concat(timelyReviewCount > 0 ? [`优先复习 ${timelyReviewCount} 词`] : [])
    .concat(backlogCount > 0 ? [`历史积压 ${backlogCount} 词`] : [])
    .join(' · ')
  const newDetail = preferences.plan.newWords >= 200
    ? '新词量大：优先安排短间隔复习，避免旧积压拖慢进度'
    : '学习新词，建立印象'
  const entriesForMode = (nextMode: StudyMode) => {
    if (nextMode === 'new') {
      return unstudiedEntries.slice(0, newPlan.remaining)
    }
    if (nextMode === 'review') return reviewDueEntries
    return dictationEntries.slice(0, preferences.plan.dictation)
  }
  const openWordManager = (
    level: WordManagerLevelFilter = 'all',
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null,
  ) => {
    wordManagerReturnFocusRef.current = returnFocus
    setWordManagerLevel(level)
    setShowWordManager(true)
  }
  const openStudy = async (nextMode: StudyMode, scope: StudyRoundScope = 'standard') => {
    const wordbookId = selectedBook.id
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    studyProgressCommittedRef.current = false
    if (nextMode === 'new' || nextMode === 'review') {
      // The server is authoritative for queue availability. Round responses carry
      // only the active word, so flashcard modes never need the complete wordbook.
      studyReturnFocusRef.current = returnFocus
      setStudyScope(scope)
      setStudyMode(nextMode)
      return
    }

    let entries: WorkspaceBook['entries'] | null
    try {
      entries = await ensureFullEntries(wordbookId)
    } catch {
      return
    }
    if (!entries || selectedBookIdRef.current !== wordbookId) return
    // Loading a large book disables the trigger before the modal mounts, which
    // makes the browser drop focus. Preserve the initiating control explicitly
    // so the shared dialog hook can restore it when the study window closes.
    studyReturnFocusRef.current = returnFocus
    // The request resolves before React necessarily commits the state update;
    // derive this one session from its returned payload rather than the old
    // render's empty `activeEntries` snapshot.
    const loadedStudyEntries = deriveStudyEntries(entries, selectedBook.reviewSchedule)
    const loadedDictationEntries = loadedStudyEntries.dictationEntries.slice(0, preferences.plan.dictation)
    if (loadedDictationEntries.length === 0) {
      setNotice('当前模式暂无可学的单词。')
      return
    }
    setStudyScope('standard')
    setStudyMode(nextMode)
  }

  return (
    <section className="workspace-page" aria-labelledby="workspace-title">
      {workspaceSidebar}

      <div ref={workspaceMainRef} className="workspace-main">
        {notice && <p className="workspace-notice" role="status">{notice}</p>}
        <section className="workspace-overview">
          <WorkspaceCover tone={selectedBook.tone} label={selectedBook.shortLabel} />
          <div className="workspace-overview-main">
            <div className="workspace-title-row"><h1 ref={workspaceTitleRef} id="workspace-title" tabIndex={-1}>{selectedBook.title}</h1></div>
            <p>{wordCount} 个单词　|　创建于 {new Date(selectedBook.createdAt).toLocaleDateString('zh-CN')}　|　最后更新：{new Date(selectedBook.updatedAt).toLocaleString('zh-CN')}</p>
            <div className={`workspace-category-editor ${categoryEditing ? 'is-editing' : ''}`}>
              <label htmlFor="wordbook-category">分类</label>
              <div className="workspace-category-field">
                <input
                  ref={categoryInputRef}
                  id="wordbook-category"
                  list={categoryEditing ? 'wordbook-categories' : undefined}
                  value={categoryDraft}
                  maxLength={30}
                  readOnly={!categoryEditing}
                  onChange={(event) => setCategoryDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && categoryEditing) {
                      event.preventDefault()
                      void saveCategory()
                    } else if (event.key === 'Escape' && categoryEditing) {
                      setCategoryDraft(selectedBook.category ?? '')
                      setCategoryEditing(false)
                    }
                  }}
                  placeholder="未分类"
                  aria-label={categoryEditing ? '编辑单词本分类' : '单词本分类'}
                />
                <button
                  type="button"
                  onClick={toggleCategoryEditing}
                  disabled={categorySaving}
                  aria-label={categoryEditing ? '保存分类' : '修改分类'}
                  title={categoryEditing ? '保存分类（Enter）' : '修改分类'}
                ><WorkspaceIcon name="edit" /></button>
              </div>
              <datalist id="wordbook-categories">
                {categories.map((category) => <option key={category} value={category} />)}
              </datalist>
            </div>
            <div className="workspace-progress-label"><span>学习进度</span><strong>{progress.percent}%</strong></div>
            <div className="workspace-progress" role="progressbar" aria-label="词本学习进度" aria-valuenow={progress.percent} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${progress.percent}%` }} /></div>
            <div className="workspace-summary-stats levels-5" role="group" aria-label="熟练度分布">
              {wordLevelStatistics.map(({ level, label, count, share }) => (
                <button
                  type="button"
                  key={level}
                  data-level={level}
                  disabled={count === 0}
                  aria-label={`${label} ${count} 个，占 ${share}%${count ? '，点击浏览' : ''}`}
                  title={count ? `浏览 ${count} 个${label}词条` : `暂无${label}词条`}
                  onClick={(event) => openWordManager(level, event.currentTarget)}
                >
                  <em>{label}<small>{share}%</small></em>
                  <strong>{count}</strong>
                  <i aria-hidden="true"><b style={{ width: `${share}%` }} /></i>
                </button>
              ))}
            </div>
          </div>
          <div className="overview-actions">
            <button type="button" className="overview-plan-settings" onClick={() => setSettingsSection('plan')}><WorkspaceIcon name="settings" />学习计划</button>
            <button type="button" disabled={!wordCount || !api} onClick={(event) => openWordManager('all', event.currentTarget)}><WorkspaceIcon name="edit" />浏览词条</button>
            {selectedBook.sourceCatalogId && <button type="button" disabled={authLoading} onClick={() => { if (!user) { setNotice('请先通过页头账号入口登录，再提交改进。'); return } setContributionBookId(selectedBook.id) }}><WorkspaceIcon name="edit" />提交改进</button>}
            <button type="button" disabled={!api || fullEntriesLoading} onClick={() => { void exportBookFile() }}><WorkspaceIcon name="book" />导出 CSV</button>
            <button type="button" disabled={!api || fullEntriesLoading} onClick={() => { void importBookFile() }}><WorkspaceIcon name="plus" />导入文件</button>
          </div>
          <button type="button" className="overview-recycle" onClick={() => moveToRecycle(selectedBook.id)}><WorkspaceIcon name="trash" />移入回收站</button>
        </section>

        <section className="workspace-plan">
          <header><h2>今日学习计划</h2><span><button type="button" onClick={() => setSettingsSection('pronunciation')}><WorkspaceIcon name="headphones" />发音</button><button type="button" onClick={() => setSettingsSection('shortcuts')}><WorkspaceIcon name="settings" />快捷键</button><button type="button" onClick={() => setSettingsSection('plan')}><WorkspaceIcon name="settings" />调整计划</button></span></header>
          <div className="plan-cards">
            <PlanCard
              icon="book"
              title="新词学习"
              count={planCounts.new}
              available={newPlanComplete
                ? Math.max(entriesLoaded ? unstudiedEntries.length : progress.unstudied, activeAheadNew?.remainingWords ?? 0)
                : Math.max(entriesLoaded ? entriesForMode('new').length : newPlan.remaining, activeNewRound?.remainingWords ?? 0)}
              resume={newPlanComplete ? Boolean(activeAheadNew) : Boolean(activeNewRound)}
              loading={fullEntriesLoading}
              completed={completedNew}
              detail={newDetail}
              button="开始学习"
              completedActionLabel="提前学习"
              onClick={() => { void openStudy('new', newPlanComplete ? 'ahead' : 'standard') }}
              onSettings={() => setSettingsSection('new')}
              extraActions={!newPlanComplete && activeAheadNew
                ? [{ label: `继续提前学习（${activeAheadNew.remainingWords}）`, onClick: () => { void openStudy('new', 'ahead') } }]
                : []}
            />
            <PlanCard
              icon="repeat"
              title="复习巩固"
              count={planCounts.review}
              available={reviewPlanComplete
                ? Math.max(reviewAheadAvailable, activeAheadReview?.remainingWords ?? 0)
                : Math.max(scheduledReviewCount, activeStandardReview?.remainingWords ?? 0)}
              resume={reviewPlanComplete ? Boolean(activeAheadReview) : Boolean(activeStandardReview)}
              loading={fullEntriesLoading}
              completed={completedReview}
              detail={reviewDetail}
              button="开始复习"
              completedActionLabel="提前复习"
              onClick={() => openStudy('review', reviewPlanComplete ? 'ahead' : 'standard')}
              onSettings={() => setSettingsSection('review')}
              extraActions={[
                ...(backlogCount > 0 || activeBacklogReview
                  ? [{ label: activeBacklogReview ? `继续清理积压（${activeBacklogReview.remainingWords}）` : `清理积压（${backlogCount}）`, onClick: () => { void openStudy('review', 'backlog') } }]
                  : []),
                ...(!reviewPlanComplete && activeAheadReview
                  ? [{ label: `继续提前复习（${activeAheadReview.remainingWords}）`, onClick: () => { void openStudy('review', 'ahead') } }]
                  : []),
              ]}
            />
            <PlanCard icon="headphones" title="听写训练" count={planCounts.dictation} available={entriesLoaded ? entriesForMode('dictation').length : Math.min(dictationEligibleCount, preferences.plan.dictation)} loading={fullEntriesLoading} completed={completedDictation} detail={dictationDetail} button="开始听写" onClick={() => { void openStudy('dictation') }} onSettings={() => setSettingsSection('dictation')} />
          </div>
        </section>

        <div className="workspace-lower">
          <RecentStudy
            activities={currentDashboard?.recentActivity}
            entries={activeBook.entries}
            entriesLoaded={entriesLoaded}
            loading={dashboardLoading}
            onContinue={() => openStudy('review')}
          />
          <StudyCalendar calendar={currentDashboard?.calendar} loading={dashboardLoading} />
        </div>
      </div>

      <aside className="workspace-rail" aria-label="快捷功能和学习数据">
        <section className="quick-actions"><h2>快捷功能</h2><QuickAction icon="book" title="单词学习" detail="认识新词，理解含义" disabled={fullEntriesLoading} onClick={() => { void openStudy('new') }} /><QuickAction icon="repeat" title="复习巩固" detail="复习旧词，加深记忆" disabled={fullEntriesLoading} onClick={() => { void openStudy('review') }} /><QuickAction icon="headphones" title="听写训练" detail="听音拼写，强化记忆" disabled={fullEntriesLoading} onClick={() => { void openStudy('dictation') }} /></section>
        <WeeklyStudyData week={currentDashboard?.week} loading={dashboardLoading} />
        <StudyStreak days={currentDashboard?.streakDays} loading={dashboardLoading} />
      </aside>
      {settingsSection && <StudySettingsDialog
        section={settingsSection}
        preferences={preferences}
        wordCount={wordCount}
        onChange={savePreferences}
        reviewSchedule={reviewSchedule}
        onReviewScheduleSave={saveReviewSchedule}
        shortcuts={shortcuts}
        onShortcutsChange={saveShortcuts}
        pronunciationPreferences={pronunciationPreferences}
        onPronunciationChange={savePronunciationPreferences}
        onClose={() => setSettingsSection(null)}
      />}
      {studyMode && <StudySessionDialog
        key={`${studyMode}-${studyScope}`}
        book={{ ...activeBook, entries: studyMode === 'dictation' ? entriesForMode(studyMode) : activeBook.entries }}
        mode={studyMode}
        scope={studyMode === 'dictation' ? 'standard' : studyScope}
        preferences={preferences.modes[studyMode]}
        shortcuts={shortcuts}
        accent={pronunciationPreferences.accent}
        returnFocus={studyReturnFocusRef.current}
        onProgressCommitted={scheduleStudyProgressRefresh}
        onClose={() => void exitStudy()}
      />}
      <ImportWordbookDialog
        key="wordbook-importer"
        open={showImporter}
        api={api}
        onClose={closeImporter}
        onCreated={(created) => { void finishImport(created) }}
        initialDraftId={resumeImportDraftId}
        initialTitle={importTargetId ? selectedBook.title : ''}
        initialDescription={importTargetId ? selectedBook.description : ''}
        initialCategory={importTargetId ? selectedBook.category : ''}
        targetWordbookId={importTargetId}
        targetWords={importTargetId ? activeBook.entries.map((entry) => entry.word) : []}
      />
      {recycleCandidate && <div className="workspace-modal-backdrop" role="presentation" onMouseDown={() => setRecycleCandidate(null)}>
        <section ref={recycleDialogRef} className="recycle-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="recycle-confirm-title" aria-describedby="recycle-confirm-body" tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}>
          <h2 id="recycle-confirm-title">移入回收站？</h2>
          <p id="recycle-confirm-body">「{recycleCandidate.title}」将从学习词本中移除，之后仍可在回收站恢复。</p>
          <div><Button variant="secondary" autoFocus onClick={() => setRecycleCandidate(null)}>取消</Button><Button onClick={() => void confirmMoveToRecycle()}>确认移入</Button></div>
        </section>
      </div>}
      {contributionBookId && <ContributionSubmitDialog
        wordbookId={contributionBookId}
        onClose={() => setContributionBookId(null)}
        onSubmitted={(contribution) => {
          setContributionBookId(null)
          setNotice(`改进建议「${contribution.title}」已提交，发布者可在协作收件箱审核。`)
        }}
      />}
      {showWordManager && <WordManagerDialog
        api={api}
        wordbookId={selectedBook.id}
        title={selectedBook.title}
        totalWords={wordCount}
        initialLevel={wordManagerLevel}
        saving={wordSaving}
        returnFocus={wordManagerReturnFocusRef.current}
        onClose={() => setShowWordManager(false)}
        onSave={saveManagedWord}
        onMarkKnown={markManagedWordKnown}
        onBatch={batchManagedWords}
      />}
    </section>
  )
}

function PlanCard({
  icon,
  title,
  count,
  available,
  resume = false,
  loading,
  completed,
  detail,
  button,
  completedActionLabel,
  onClick,
  onSettings,
  extraActions = [],
}: {
  icon: 'book' | 'repeat' | 'headphones'
  title: string
  count: number
  available: number
  resume?: boolean
  loading: boolean
  completed: number
  detail: string
  button: string
  completedActionLabel?: string
  onClick: () => void
  onSettings: () => void
  extraActions?: Array<{ label: string; onClick: () => void }>
}) {
  const progress = count ? Math.min(100, completed / count * 100) : 0
  const remaining = remainingPlanWords(count, completed)
  const startable = available > 0
  const label = studyPlanActionLabel({
    target: count,
    completed,
    available,
    loading,
    resume,
    startLabel: button,
    completedActionLabel,
  })
  return <article className="plan-card">
    <WorkspaceIcon name={icon} />
    <h3>{title}</h3>
    <button type="button" className="plan-card-settings" aria-label={`设置${title}`} title={`设置${title}`} onClick={onSettings}><WorkspaceIcon name="settings" /></button>
    <p>{detail}</p>
    <strong>{remaining}<small>词待完成</small></strong>
    <div className="plan-card-progress"><span className="plan-card-progress-track"><i style={{ width: `${progress}%` }} /></span><span className="plan-card-progress-count">{Math.min(completed, count)}/{count}</span></div>
    <button type="button" disabled={!startable || loading} onClick={onClick}>{label}</button>
    {extraActions.length > 0 && <div className="plan-card-extra-actions">{extraActions.map((action) => <button type="button" key={action.label} disabled={loading} onClick={action.onClick}>{action.label}</button>)}</div>}
  </article>
}

function QuickAction({ icon, title, detail, disabled = false, onClick }: { icon: 'book' | 'repeat' | 'headphones' | 'card'; title: string; detail: string; disabled?: boolean; onClick: () => void }) {
  return <button type="button" disabled={disabled} onClick={onClick}><span><WorkspaceIcon name={icon} /></span><div><strong>{title}</strong><small>{detail}</small></div><WorkspaceIcon name="chevron" /></button>
}

function RecentStudy({ activities, entries, entriesLoaded, loading, onContinue }: { activities: StudyDashboard['recentActivity'] | undefined; entries: WordbookItem[]; entriesLoaded: boolean; loading: boolean; onContinue: () => void }) {
  const entriesByWord = useMemo(() => new Map(entries.map((entry) => [entry.word, entry])), [entries])
  const rows = useMemo(
    () => activities ? toRecentStudyRows(activities, entriesByWord, entriesLoaded) : [],
    [activities, entriesByWord, entriesLoaded],
  )
  return <section className="recent-study">
    <header><h2>最近学习</h2><button type="button" onClick={onContinue}>继续学习 ›</button></header>
    {loading && !activities ? <p className="workspace-data-state" role="status">正在载入学习记录。</p> : rows.length ? (
      <div className="recent-study-table-wrap">
        <table>
          <caption className="workspace-visually-hidden">最近学习记录</caption>
          <thead><tr><th scope="col">单词</th><th scope="col">词性</th><th scope="col">释义</th><th scope="col">结果</th><th scope="col">时间</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.id}><th scope="row">{row.word}</th><td>{row.pos}</td><td title={row.definition}>{row.definition}</td><td><span className={row.resultTone}>{row.result}</span></td><td><time>{row.time}</time></td></tr>)}</tbody>
        </table>
      </div>
    ) : <p className="workspace-data-state">{activities ? '还没有学习记录。' : '学习记录暂不可用。'}</p>}
  </section>
}

function WeeklyStudyData({ week, loading }: { week: StudyDashboard['week'] | undefined; loading: boolean }) {
  const counts = week ? { new: week.newCount, review: week.reviewCount, dictation: week.dictationCount } : null
  const total = week?.total ?? 0
  const categoryTotal = counts ? counts.new + counts.review + counts.dictation : 0
  const newStop = categoryTotal ? counts!.new / categoryTotal * 100 : 0
  const reviewStop = categoryTotal ? newStop + counts!.review / categoryTotal * 100 : 0
  const donutStyle = categoryTotal ? {
    '--week-new-stop': `${newStop}%`,
    '--week-review-stop': `${reviewStop}%`,
  } as CSSProperties : undefined

  return <section className="workspace-data">
    <header><h2>学习数据</h2><span>本周</span></header>
    {!counts ? <p className="workspace-data-state" role={loading ? 'status' : undefined}>{loading ? '正在载入学习数据。' : '学习数据暂不可用。'}</p> : <>
      <div
        className={`data-donut${total ? '' : ' is-empty'}`}
        style={donutStyle}
        role="img"
        aria-label={`本周共学习 ${total} 词：新词学习 ${counts.new} 词，复习巩固 ${counts.review} 词，听写训练 ${counts.dictation} 词。`}
      ><span>本周学习<strong>{total} 词</strong></span></div>
      <ul aria-label="本周学习类型明细">{WEEK_METRICS.map((metric) => <li key={metric.key}><i className={metric.className} /><span>{metric.label}</span><strong>{counts[metric.key]}</strong></li>)}</ul>
    </>}
  </section>
}

function StudyCalendar({ calendar, loading }: { calendar: StudyDashboard['calendar'] | undefined; loading: boolean }) {
  const lastWeek = calendar?.slice(-7) ?? []
  const days = lastWeek.map((entry, index) => ({ label: index === lastWeek.length - 1 ? '今天' : entry.date.slice(5).replace('-', '/'), count: entry.count, active: entry.active, today: index === lastWeek.length - 1 }))
  return <section className="study-calendar"><header><h2>学习日历</h2></header>{!calendar ? <p className="workspace-data-state" role={loading ? 'status' : undefined}>{loading ? '正在载入学习日历。' : '学习日历暂不可用。'}</p> : days.length ? <div className="calendar-days">{days.map((day) => <article key={day.label} className={day.today ? 'today' : ''}><strong>{day.label}</strong><small>{day.count}词</small><span>{day.active ? '✓' : '○'}</span></article>)}</div> : <p className="workspace-data-state">暂无学习日历数据。</p>}</section>
}

function StudyStreak({ days, loading }: { days: number | undefined; loading: boolean }) {
  return <section className="study-streak"><h2><WorkspaceIcon name="fire" />连续学习</h2>{days === undefined ? <p className="workspace-data-state" role={loading ? 'status' : undefined}>{loading ? '正在载入连续学习数据。' : '连续学习数据暂不可用。'}</p> : <><strong>{days} <small>天</small></strong><p>继续保持！</p><div>{['一','二','三','四','五','六','日'].map((day, index) => <span key={day}><small>{day}</small><i className={index < Math.min(7, days) ? 'complete' : ''}>{index < Math.min(7, days) ? '✓' : ''}</i></span>)}</div></>}</section>
}

const REVIEW_SCHEDULE_FIELDS: Array<{ key: keyof ReviewSchedule; label: string; detail: string }> = [
  { key: 'learningDays', label: '初识后复习', detail: '第一次完成新词学习后的间隔' },
  { key: 'familiarDays', label: '熟悉后复习', detail: '通过单词卡后的基础间隔' },
  { key: 'masteredDays', label: '掌握后复习', detail: '完成听写后的基础间隔' },
  { key: 'expertDays', label: '精通后复习', detail: '进入长期记忆后的基础间隔' },
  { key: 'lapseDays', label: '答错后复习', detail: '遗忘或拼写错误后的短期回访' },
  { key: 'maxDays', label: '最长间隔', detail: '连续答对时不会超过该间隔' },
]

type StudySettingsDialogProps = {
  section: SettingsSection
  preferences: WordbookStudyPreferences
  shortcuts: StudyShortcutPreferences
  pronunciationPreferences: PronunciationPreferences
  reviewSchedule: ReviewSchedule
  wordCount: number
  onChange: (next: WordbookStudyPreferences) => void
  onShortcutsChange: (next: StudyShortcutPreferences) => void
  onPronunciationChange: (next: PronunciationPreferences) => void
  onReviewScheduleSave: (next: ReviewSchedule) => Promise<boolean>
  onClose: () => void
}

function StudySettingsDialog({
  section,
  preferences,
  shortcuts,
  pronunciationPreferences,
  reviewSchedule,
  wordCount,
  onChange,
  onShortcutsChange,
  onPronunciationChange,
  onReviewScheduleSave,
  onClose,
}: StudySettingsDialogProps) {
  const [scheduleDraft, setScheduleDraft] = useState<ReviewSchedule>(() => structuredClone(reviewSchedule))
  const [scheduleError, setScheduleError] = useState('')
  const [scheduleSaving, setScheduleSaving] = useState(false)

  const titles: Record<SettingsSection, string> = {
    plan: '自定义学习计划',
    pronunciation: '英语发音设置',
    shortcuts: '键盘快捷键',
    new: '新词学习设置',
    review: '复习巩固设置',
    dictation: '听写训练设置',
  }
  const updatePlan = (key: 'newWords' | 'dictation' | 'backlogReviews', value: number) => onChange({
    ...preferences,
    plan: { ...preferences.plan, [key]: Math.max(0, Math.min(999, Math.round(value || 0))) },
  })
  const updateReviewSchedule = (key: keyof ReviewSchedule, value: number) => {
    setScheduleDraft((current) => ({
      ...current,
      [key]: Math.max(0, Math.min(3650, Math.round(value || 0))),
    }))
    setScheduleError('')
  }
  const finish = async () => {
    if (section !== 'plan' || sameReviewSchedule(scheduleDraft, reviewSchedule)) {
      onClose()
      return
    }
    const parsed = parseReviewSchedule(scheduleDraft)
    if (!parsed) {
      setScheduleError('各间隔需为 1–3650 天，并满足：初识 ≤ 熟悉 ≤ 掌握 ≤ 精通 ≤ 最长间隔，答错回访 ≤ 最长间隔。')
      return
    }
    setScheduleSaving(true)
    const saved = await onReviewScheduleSave(parsed)
    setScheduleSaving(false)
    if (saved) onClose()
  }
  const updateMode = (key: keyof DictationDisplayPreferences, value: boolean | 'zh' | 'en') => {
    if (section === 'plan' || section === 'pronunciation' || section === 'shortcuts') return
    onChange({
      ...preferences,
      modes: {
        ...preferences.modes,
        [section]: { ...preferences.modes[section], [key]: value },
      },
    })
  }
  const toggleExercise = (exercise: StudyExerciseType) => {
    if (section !== 'new' && section !== 'review') return
    const current = preferences.modes[section].exerciseTypes
    const selected = current.includes(exercise)
    if (selected && current.length === 1) return
    onChange({
      ...preferences,
      modes: {
        ...preferences.modes,
        [section]: {
          ...preferences.modes[section],
          exerciseTypes: selected
            ? current.filter((item) => item !== exercise)
            : [...current, exercise],
        },
      },
    })
  }
  const modePreferences = section === 'plan' || section === 'pronunciation' || section === 'shortcuts' ? null : preferences.modes[section]
  const requestClose = () => { if (!scheduleSaving) onClose() }
  const dialogRef = useModalDialog<HTMLElement>({ open: true, onClose: requestClose, canClose: !scheduleSaving })

  return <div className="workspace-modal-backdrop" role="presentation" onMouseDown={requestClose}>
    <section ref={dialogRef} className="study-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="study-settings-title" tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}>
      <header><div><p className="marginal">{section === 'plan' ? '当前词本' : '学习体验'}</p><h2 id="study-settings-title">{titles[section]}</h2></div><button type="button" className="workspace-modal-close" aria-label="关闭设置" disabled={scheduleSaving} onClick={requestClose}>×</button></header>
      {section === 'plan' ? <div className="study-plan-settings">
        <label><span><strong>每日新词</strong><small>计划学习的未学习单词数</small></span><input type="number" min="0" max="999" inputMode="numeric" value={preferences.plan.newWords} onChange={(event) => updatePlan('newWords', Number(event.target.value))} /><em>词</em></label>
        <label><span><strong>每日听写</strong><small>每轮听写抽取的单词数</small></span><input type="number" min="0" max="999" inputMode="numeric" value={preferences.plan.dictation} onChange={(event) => updatePlan('dictation', Number(event.target.value))} /><em>词</em></label>
        <label><span><strong>每日积压上限</strong><small>标准复习中最多混入的历史过期单词；设为 0 可完全隔离</small></span><input type="number" min="0" max="999" inputMode="numeric" value={preferences.plan.backlogReviews} onChange={(event) => updatePlan('backlogReviews', Number(event.target.value))} /><em>词</em></label>
        {preferences.plan.newWords >= 200 && <p className="study-load-warning">当前新词量较高。系统会优先安排新词的短间隔复习，并把超期旧词限制在上面的积压额度内；仍建议根据后续可持续的复习量调整计划。</p>}
        <section className="review-schedule-settings" aria-labelledby="review-schedule-title">
          <header>
            <span><strong id="review-schedule-title">遗忘曲线复习方案</strong><small>{isDefaultReviewSchedule(scheduleDraft) ? '当前为默认方案' : '当前为自定义方案'}</small></span>
            <button type="button" disabled={scheduleSaving || isDefaultReviewSchedule(scheduleDraft)} onClick={() => { setScheduleDraft(structuredClone(DEFAULT_REVIEW_SCHEDULE)); setScheduleError('') }}>恢复默认</button>
          </header>
          <div>
            {REVIEW_SCHEDULE_FIELDS.map((field) => <label key={field.key}>
              <span><strong>{field.label}</strong><small>{field.detail}</small></span>
              <input type="number" min="1" max="3650" inputMode="numeric" value={scheduleDraft[field.key]} onChange={(event) => updateReviewSchedule(field.key, Number(event.target.value))} />
              <em>天</em>
            </label>)}
          </div>
          {scheduleError && <p className="review-schedule-error" role="alert">{scheduleError}</p>}
        </section>
        <p className="study-settings-note">默认采用 1 / 3 / 7 / 21 天的渐进间隔。短间隔和重学任务优先，正常到期任务其次，历史积压最后且受每日上限控制；额外积压可从复习卡片单独清理。当前词本共 {wordCount} 词。</p>
      </div> : section === 'pronunciation' ? <div className="study-mode-settings">
        <fieldset><legend>默认英语口音</legend><div className="meaning-preference">
          <button type="button" className={pronunciationPreferences.accent === 'gb' ? 'selected' : ''} onClick={() => onPronunciationChange({ accent: 'gb' })}>英式发音</button>
          <button type="button" className={pronunciationPreferences.accent === 'us' ? 'selected' : ''} onClick={() => onPronunciationChange({ accent: 'us' })}>美式发音</button>
        </div><small>查词、单词卡和听写会优先播放所选口音；录音不可用时，浏览器朗读也使用同一口音。</small></fieldset>
      </div> : section === 'shortcuts' ? <ShortcutSettings value={shortcuts} onChange={onShortcutsChange} /> : modePreferences && <div className="study-mode-settings">
        {(section === 'new' || section === 'review') && <fieldset><legend>练习方式（至少选择一项）</legend><div className="exercise-preference">
          <button type="button" className={preferences.modes[section].exerciseTypes.includes('self-rating') ? 'selected' : ''} aria-pressed={preferences.modes[section].exerciseTypes.includes('self-rating')} onClick={() => toggleExercise('self-rating')}><strong>回忆判断</strong><small>认识 / 模糊 / 不认识</small></button>
          <button type="button" className={preferences.modes[section].exerciseTypes.includes('meaning-choice') ? 'selected' : ''} aria-pressed={preferences.modes[section].exerciseTypes.includes('meaning-choice')} onClick={() => toggleExercise('meaning-choice')}><strong>看词选义</strong><small>混入词干、前后缀或拼写相近词</small></button>
        </div><small>两项都选择时，每个单词必须分别完成两种练习；取消最后一项会被阻止。</small></fieldset>}
        <fieldset><legend>默认释义</legend><div className="meaning-preference">
          <button type="button" className={modePreferences.meaningPreference === 'zh' ? 'selected' : ''} onClick={() => updateMode('meaningPreference', 'zh')}>中文释义优先</button>
          <button type="button" className={modePreferences.meaningPreference === 'en' ? 'selected' : ''} onClick={() => updateMode('meaningPreference', 'en')}>英英释义优先</button>
        </div><small>所选语言缺失时会自动回退，保证始终有释义可看。</small></fieldset>
        {(section !== 'dictation' || preferences.modes.dictation.showMeaning) && <SettingToggle label="显示例句" detail="在答案或卡片背面展示词典例句" checked={modePreferences.showExamples} onChange={(value) => updateMode('showExamples', value)} />}
        <SettingToggle label="显示音标" detail="在词头或答案中展示音标" checked={modePreferences.showPhonetic} onChange={(value) => updateMode('showPhonetic', value)} />
        {section !== 'dictation' && (
          <SettingToggle label="自动播放发音" detail="每张新卡出现时自动播放一次" checked={modePreferences.autoPlayAudio} onChange={(value) => updateMode('autoPlayAudio', value)} />
        )}
        {section === 'dictation' && <>
          <SettingToggle label="自动播放发音" detail="进入每道新题时自动播放一次" checked={preferences.modes.dictation.autoPlayAudio} onChange={(value) => updateMode('autoPlayAudio', value)} />
          <SettingToggle label="显示释义" detail="答题前和判题后显示所选语言的释义" checked={preferences.modes.dictation.showMeaning} onChange={(value) => updateMode('showMeaning', value)} />
          <SettingToggle label="显示字符位数" detail="用空心方框提示答案长度，保留连字符和撇号" checked={preferences.modes.dictation.showCharacterMask} onChange={(value) => updateMode('showCharacterMask', value)} />
          <SettingToggle label="标出错字母" detail="用红色下划线标记输入中位置错误的字母" checked={preferences.modes.dictation.underlineMistakes} onChange={(value) => updateMode('underlineMistakes', value)} />
        </>}
      </div>}
      <footer><Button disabled={scheduleSaving} onClick={() => { void finish() }}>{scheduleSaving ? '保存中…' : '完成'}</Button></footer>
    </section>
  </div>
}

function SettingToggle({ label, detail, checked, onChange }: { label: string; detail: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="study-setting-toggle"><span><strong>{label}</strong><small>{detail}</small></span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><i aria-hidden="true" /></label>
}

const SHORTCUT_ROWS: Array<{ action: StudyShortcutAction; label: string; group: 'card' | 'dictation' }> = [
  { action: 'unknown', label: '不认识', group: 'card' },
  { action: 'vague', label: '模糊', group: 'card' },
  { action: 'pronounce', label: '播放发音', group: 'card' },
  { action: 'known', label: '认识', group: 'card' },
  { action: 'mastered', label: '标熟', group: 'card' },
  { action: 'flip', label: '翻面', group: 'card' },
  { action: 'dictationPronounce', label: '听写播放发音', group: 'dictation' },
]

function ShortcutSettings({ value, onChange }: { value: StudyShortcutPreferences; onChange: (next: StudyShortcutPreferences) => void }) {
  const [error, setError] = useState('')
  const capture = (action: StudyShortcutAction, event: React.KeyboardEvent<HTMLInputElement>) => {
    event.preventDefault()
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) { setError('请使用不带组合键的单个按键。'); return }
    const key = normalizeShortcutKey(event.key)
    if (!key || (action === 'dictationPronounce' && key === 'enter')) { setError('这个按键保留给关闭、输入法或听写提交，请换一个。'); return }
    const group = SHORTCUT_ROWS.find((row) => row.action === action)?.group
    const conflict = SHORTCUT_ROWS.find((row) => row.action !== action && row.group === group && value[row.action] === key)
    if (conflict) { setError(`与“${conflict.label}”冲突。`); return }
    setError('')
    onChange({ ...value, [action]: key })
  }
  return <div className="shortcut-settings">
    <p>点击按键框后直接按下新按键。卡片快捷键用于新词和复习，听写 Enter 始终用于提交。</p>
    {SHORTCUT_ROWS.map((row) => <label key={row.action}><span><strong>{row.label}</strong><small>{row.group === 'card' ? '新词 / 复习' : '听写输入框内可用'}</small></span><input readOnly value={shortcutLabel(value[row.action])} aria-label={`设置${row.label}快捷键`} onKeyDown={(event) => capture(row.action, event)} /></label>)}
    {error && <p className="field-error" role="alert">{error}</p>}
    <button type="button" onClick={() => { setError(''); onChange({ ...DEFAULT_STUDY_SHORTCUTS }) }}>恢复默认快捷键</button>
  </div>
}

function StudySessionDialog({
  book,
  mode,
  scope,
  preferences,
  shortcuts,
  accent,
  returnFocus,
  onProgressCommitted,
  onClose,
}: {
  book: WorkspaceBook
  mode: StudyMode
  scope: StudyRoundScope
  preferences: FlashcardDisplayPreferences | DictationDisplayPreferences
  shortcuts: StudyShortcutPreferences
  accent: EnglishAccent
  returnFocus: HTMLElement | null
  onProgressCommitted?: () => void
  onClose: () => void
}) {
  const [sessionBook] = useState(book)
  const guardedCloseRef = useRef<() => void>(onClose)
  const requestClose = useCallback(() => guardedCloseRef.current(), [])
  const registerCloseGuard = useCallback((handler: () => void) => { guardedCloseRef.current = handler }, [])
  const dialogRef = useModalDialog<HTMLElement>({ open: true, onClose: requestClose, returnFocus })

  return <div className="workspace-modal-backdrop study-session-backdrop" role="presentation">
    <section ref={dialogRef} className="workspace-study-modal" role="dialog" aria-modal="true" aria-label={`${mode === 'new' ? '新词学习' : mode === 'review' ? '复习巩固' : '听写训练'}悬浮窗口`} tabIndex={-1}>
      <button type="button" className="workspace-modal-close session-close" aria-label="关闭学习窗口" onClick={requestClose}>×</button>
      <WordbookStudyMode book={sessionBook} mode={mode} scope={scope} preferences={preferences} shortcuts={shortcuts} accent={accent} onProgressCommitted={onProgressCommitted} onExit={onClose} registerCloseGuard={registerCloseGuard} />
    </section>
  </div>
}

function WordbookStudyMode({
  book,
  mode,
  scope,
  preferences,
  shortcuts,
  accent,
  onProgressCommitted,
  onExit,
  registerCloseGuard,
}: {
  book: WorkspaceBook
  mode: StudyMode
  scope: StudyRoundScope
  preferences: FlashcardDisplayPreferences | DictationDisplayPreferences
  shortcuts: StudyShortcutPreferences
  accent: EnglishAccent
  onProgressCommitted?: () => void
  onExit: () => void
  registerCloseGuard?: (handler: () => void) => void
}) {
  if (mode !== 'dictation') {
    return <section className="workspace-study">
      <StudyHeader book={book} mode={mode} onExit={onExit} />
      <SyncedFlashcardRound
        wordbookId={book.id}
        mode={mode}
        scope={scope}
        preferences={preferences as FlashcardDisplayPreferences}
        shortcuts={shortcuts}
        accent={accent}
        nextReviewDays={mode === 'new' ? book.reviewSchedule.learningDays : undefined}
        onProgressCommitted={onProgressCommitted}
        onClose={onExit}
      />
    </section>
  }
  return <DictationStudyMode
    book={book}
    preferences={preferences as DictationDisplayPreferences}
    shortcuts={shortcuts}
    accent={accent}
    onProgressCommitted={onProgressCommitted}
    onExit={onExit}
    registerCloseGuard={registerCloseGuard}
  />
}

function DictationStudyMode({
  book,
  preferences,
  shortcuts,
  accent,
  onProgressCommitted,
  onExit,
  registerCloseGuard,
}: {
  book: WorkspaceBook
  preferences: DictationDisplayPreferences
  shortcuts: StudyShortcutPreferences
  accent: EnglishAccent
  onProgressCommitted?: () => void
  onExit: () => void
  registerCloseGuard?: (handler: () => void) => void
}) {
  const api = getWorkspaceApi()
  const pendingReports = useRef<Set<Promise<unknown>>>(new Set())
  const reportChain = useRef<Promise<unknown>>(Promise.resolve())
  const enqueueReport = useCallback((operation: () => Promise<unknown>) => {
    const promise = reportChain.current.then(async () => {
      const result = await operation()
      onProgressCommitted?.()
      return result
    }).catch(() => undefined)
    reportChain.current = promise
    pendingReports.current.add(promise)
    void promise.finally(() => pendingReports.current.delete(promise))
  }, [onProgressCommitted])
  const reportGrade = useCallback((word: string, correct: boolean) => {
    if (!api) return
    enqueueReport(() => api.recordStudyEvent({ kind: 'dictation', word, correct, wordbookId: book.id }))
  }, [api, book.id, enqueueReport])
  const exitAfterReports = useCallback(async () => {
    await Promise.allSettled([...pendingReports.current])
    onExit()
  }, [onExit])
  useEffect(() => {
    registerCloseGuard?.(() => { void exitAfterReports() })
  }, [exitAfterReports, registerCloseGuard])
  const dictation = useDictationSession(book.entries, reportGrade)
  const { pronounce, stop } = usePronounce(dictation.current?.word ?? '', .78, accent)
  const shortcutBindings = useMemo(
    () => [{ key: shortcuts.dictationPronounce, action: pronounce, allowInInput: true }],
    [pronounce, shortcuts.dictationPronounce],
  )
  useKeyboardShortcuts(shortcutBindings, dictation.phase !== 'summary')
  useEffect(() => {
    const ready = dictation.phase === 'prompt' && Boolean(dictation.current)
    if (!preferences.autoPlayAudio || !ready) return
    const timer = window.setTimeout(pronounce, 0)
    return () => {
      window.clearTimeout(timer)
      stop()
    }
  }, [dictation.current, dictation.phase, preferences.autoPlayAudio, pronounce, stop])

  if (book.entries.length === 0) return <section className="workspace-study"><StudyHeader book={book} mode="dictation" onExit={() => void exitAfterReports()} /><EmptyState title="暂无可用于听写训练的单词" body="先学习一些单词，学过的单词才会进入听写训练。" action={<Button onClick={() => void exitAfterReports()}>关闭窗口</Button>} /></section>

  const lastAnswer = dictation.answers[dictation.answers.length - 1]
  return <section className="workspace-study"><StudyHeader book={book} mode="dictation" onExit={() => void exitAfterReports()} />{dictation.phase === 'summary' ? <div className="workspace-session-summary"><DictationSummary total={dictation.deck.length} correct={dictation.correctCount} wrong={dictation.wrongDeck} attempts={dictation.attemptCount} incorrect={dictation.incorrectCount} skipped={dictation.skippedCount} meaningPreference={preferences.meaningPreference} onRetryAll={dictation.retryAll} onRetryWrong={dictation.retryWrong} /><Button variant="secondary" onClick={() => void exitAfterReports()}>关闭窗口</Button></div> : <><div className="workspace-study-progress"><span>听写训练</span><strong>已过关 {dictation.passedCount} / {dictation.deck.length}</strong></div>{dictation.current && <DictationPrompt item={dictation.current} answer={dictation.answer} onAnswerChange={dictation.setAnswer} onSubmit={dictation.submit} onSkip={dictation.skip} onNext={dictation.next} onPlay={pronounce} phase={dictation.phase} grade={dictation.phase === 'feedback' ? lastAnswer?.grade ?? null : null} error={dictation.inputError} isLast={dictation.isLast} currentStreak={dictation.currentStreak} requiredStreak={dictation.requiredStreak} accent={accent} preferences={preferences} />}<ShortcutHint shortcuts={[{ keys: shortcutLabel(shortcuts.dictationPronounce), action: '播放发音' }, { keys: 'Enter', action: dictation.phase === 'prompt' ? '提交' : '继续' }]} /></>}</section>
}

function StudyHeader({ book, mode, onExit }: { book: WorkspaceBook; mode: StudyMode; onExit: () => void }) {
  return <header className="workspace-study-header"><button type="button" onClick={onExit}>关闭</button><span><WorkspaceCover tone={book.tone} label={book.shortLabel} small /><strong>{book.title}</strong></span><h1>{mode === 'new' ? '新词学习' : mode === 'review' ? '复习巩固' : '听写训练'}</h1></header>
}
