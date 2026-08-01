import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { Link, useSearchParams } from 'react-router'
import {
  getWorkspaceApi,
  WorkspaceApiError,
  type CatalogExam,
  type CatalogQuery,
  type CatalogVisibility,
  type CatalogWordbook,
  type LearningGoal,
  type MyWordbook,
} from '../data/workspaceApi'
import { useAuth } from '../hooks/useAuth'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

type IconName = 'search' | 'filter' | 'plus' | 'share' | 'grid' | 'list' | 'book' | 'star' | 'people' | 'heart' | 'cloud' | 'refresh'
type CoverTone = 'blue' | 'amber' | 'green' | 'lavender' | 'rose' | 'slate'
export type MarketplaceBook = {
  id: string
  title: string
  description: string
  author: string
  wordCount: number
  rating: number
  favoriteCount?: number
  learners: string
  category: string
  exam: string
  tone: CoverTone
  shortLabel: string
  uploaded: boolean
  added: boolean
  shareCode: string
  visibility?: CatalogVisibility
  exams: string[]
  goals: string[]
  openContributionCount?: number
}
type PublishStep = 'details' | 'preview'
type PublishForm = {
  sourceWordbookId: string
  title: string
  description: string
  exam: string
  goal: string
  visibility: CatalogVisibility
  revisionMessage: string
}
type PublishCatalogInput = {
  sourceWordbookId: string
  expectedHeadRevisionId?: string
  title: string
  description: string
  exams: string[]
  goals: string[]
  visibility: CatalogVisibility
  message?: string
}
type PublishingWorkspaceApi = {
  updateCatalogSnapshot?: (catalogId: string, input: PublishCatalogInput) => Promise<unknown>
}

const MARKETPLACE_CATEGORIES = ['全部', 'IELTS', 'TOEFL', 'GRE', '高考', '四级', '六级', '考研', '写作', '阅读', '听力', '口语']
const PUBLISH_EXAMS = ['IELTS', 'TOEFL', 'GRE', '高考', '四级', '六级', '考研']
const PUBLISH_GOALS = ['写作', '阅读', '听力', '口语']
const EMPTY_PUBLISH_FORM: PublishForm = { sourceWordbookId: '', title: '', description: '', exam: '', goal: '', visibility: 'public', revisionMessage: '' }
const VISIBILITY_OPTIONS: Array<{ value: CatalogVisibility; label: string; hint: string }> = [
  { value: 'public', label: '公开', hint: '所有人可在广场看到' },
  { value: 'unlisted', label: '邀请码', hint: '不进列表，凭分享码导入' },
  { value: 'private', label: '私密', hint: '仅自己可见' },
]
const VISIBILITY_LABELS: Record<CatalogVisibility, string> = { public: '公开', unlisted: '邀请码', private: '私密' }
const UPLOAD_LOGIN_HINT = '登录后才能上传和管理单词本'
const MODAL_FOCUSABLE = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'
const MARKETPLACE_EXAM_FILTERS = ['IELTS', 'TOEFL', 'GRE', '高考', '四级', '六级']
const MARKETPLACE_GOAL_FILTERS = ['写作', '阅读', '听力', '口语']
type MarketplaceSort = 'popular' | 'latest' | 'rating'
type MarketplaceView = 'grid' | 'list'

export type MarketplaceUrlState = {
  query: string
  category: string
  examFilters: string[]
  goalFilters: string[]
  sort: MarketplaceSort
  view: MarketplaceView
}

export function readMarketplaceUrlState(params: URLSearchParams): MarketplaceUrlState {
  const category = params.get('category')
  const sort = params.get('sort')
  const view = params.get('view')
  return {
    query: params.get('q') ?? '',
    category: category && MARKETPLACE_CATEGORIES.includes(category) ? category : '全部',
    examFilters: [...new Set(params.getAll('exam').filter((value) => MARKETPLACE_EXAM_FILTERS.includes(value)))],
    goalFilters: [...new Set(params.getAll('goal').filter((value) => MARKETPLACE_GOAL_FILTERS.includes(value)))],
    sort: sort === 'latest' || sort === 'rating' ? sort : 'popular',
    view: view === 'list' ? 'list' : 'grid',
  }
}

export function writeMarketplaceUrlState(params: URLSearchParams, state: MarketplaceUrlState): URLSearchParams {
  const next = new URLSearchParams(params)
  for (const key of ['q', 'category', 'exam', 'goal', 'sort', 'view']) next.delete(key)
  if (state.query) next.set('q', state.query)
  if (state.category !== '全部') next.set('category', state.category)
  for (const exam of state.examFilters) next.append('exam', exam)
  for (const goal of state.goalFilters) next.append('goal', goal)
  if (state.sort !== 'popular') next.set('sort', state.sort)
  if (state.view !== 'grid') next.set('view', state.view)
  return next
}

export function marketplaceDetailHref(id: string, marketplaceSearch: string): string {
  const returnParams = new URLSearchParams()
  if (marketplaceSearch) returnParams.set('from', marketplaceSearch)
  const query = returnParams.toString()
  return `/marketplace/${encodeURIComponent(id)}${query ? `?${query}` : ''}`
}

export function parseMarketplaceCollection(value: string | null): 'all' | 'favorites' | 'uploads' {
  return value === 'favorites' || value === 'uploads' ? value : 'all'
}

export function isSnapshotSourceLocked(
  sourceWordbookId: string | undefined,
  wordbooks: readonly Pick<MyWordbook, 'id'>[],
): boolean {
  return Boolean(sourceWordbookId && wordbooks.some((book) => book.id === sourceWordbookId))
}

// Prefer the structured API status; retain the message fallback for older
// injected repositories used by tests and local integrations.
function isAuthRequiredError(error: unknown): boolean {
  return error instanceof WorkspaceApiError
    ? error.status === 401
    : error instanceof Error && (error.message.includes('(401)') || error.message.includes('AUTH_REQUIRED_FOR_PUBLIC'))
}

const MARKETPLACE_ICON_PATHS: Record<IconName, ReactNode> = {
  search: <><circle cx="10.5" cy="10.5" r="5.75" /><path d="m15 15 4.25 4.25" /></>,
  filter: <path d="M4 5h16l-6.2 7.1v5l-3.6 1.8v-6.8z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  share: <><path d="M8 12a4 4 0 0 1 4-4h3" /><path d="m13 5 3 3-3 3" /><path d="M16 12a4 4 0 0 1-4 4H9" /><path d="m11 15-3-3 3-3" /></>,
  grid: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></>,
  list: <><path d="M8 6h11M8 12h11M8 18h11" /><circle cx="4.5" cy="6" r=".75" fill="currentColor" /><circle cx="4.5" cy="12" r=".75" fill="currentColor" /><circle cx="4.5" cy="18" r=".75" fill="currentColor" /></>,
  book: <><path d="M4.5 5.5c3.2-1.2 5.8-.6 7.5 1.5v12c-1.7-2.1-4.3-2.7-7.5-1.5z" /><path d="M19.5 5.5C16.3 4.3 13.7 4.9 12 7v12c1.7-2.1 4.3-2.7 7.5-1.5z" /></>,
  star: <path d="m12 4 2.2 4.45 4.9.7-3.55 3.45.84 4.88L12 15.2l-4.39 2.3.84-4.88L4.9 9.15l4.9-.7z" />,
  people: <><circle cx="9" cy="9" r="3" /><path d="M3.75 19a5.25 5.25 0 0 1 10.5 0M15.5 7.25a2.7 2.7 0 0 1 0 5.25M16.5 14a4.2 4.2 0 0 1 3.75 5" /></>,
  heart: <path d="M12 19s-7-4.2-7-9.1A3.9 3.9 0 0 1 12 7.5a3.9 3.9 0 0 1 7 2.4C19 14.8 12 19 12 19Z" />,
  cloud: <><path d="M7.5 18.5h9.25a3.75 3.75 0 0 0 .35-7.48 5.5 5.5 0 0 0-10.65 1.46A3.2 3.2 0 0 0 7.5 18.5Z" /><path d="M12 10v6M9.75 13.75 12 16l2.25-2.25" /></>,
  refresh: <><path d="M18.5 8.5A7 7 0 0 0 6.1 7L4.5 9" /><path d="M4.5 5.5V9H8" /><path d="M5.5 15.5A7 7 0 0 0 17.9 17l1.6-2" /><path d="M19.5 18.5V15H16" /></>,
}

function MarketplaceIcon({ name }: { name: IconName }) {
  return <svg className="market-icon" viewBox="0 0 24 24" aria-hidden="true">{MARKETPLACE_ICON_PATHS[name]}</svg>
}

function BookCover({ tone, label }: { tone: CoverTone; label: string }) {
  return <div className={`book-cover cover-${tone}`} aria-hidden="true"><span>{label}</span><i /></div>
}

export function catalogToMarketplace(book: CatalogWordbook, index: number): MarketplaceBook {
  const tones: CoverTone[] = ['blue', 'amber', 'green', 'rose', 'lavender', 'slate']
  const category = book.goals[0] ?? book.exams[0] ?? '全部'
  return {
    id: book.id,
    title: book.title,
    description: book.description,
    author: book.author,
    wordCount: book.wordCount,
    rating: book.rating,
    favoriteCount: book.favoriteCount,
    learners: book.uses >= 10_000 ? `${(book.uses / 10_000).toFixed(1)}万人使用` : `${book.uses}人使用`,
    category,
    exam: book.exams[0] ?? '',
    tone: tones[index % tones.length],
    shortLabel: (book.exams[0] ?? book.title.slice(0, 5)).toUpperCase(),
    uploaded: book.uploaded,
    added: book.added,
    shareCode: book.shareCode,
    visibility: book.visibility,
    exams: book.exams,
    goals: book.goals,
    openContributionCount: book.openContributionCount ?? 0,
  }
}

export function marketplaceCatalogQuery(
  examFilters: readonly string[],
  goalFilters: readonly string[],
  sort: 'popular' | 'latest' | 'rating',
): CatalogQuery {
  return {
    // A single filter can be narrowed server-side. With multiple selections the
    // UI means OR, so fetch the full shelf and apply the OR locally.
    ...(examFilters.length === 1 ? { exam: examFilters[0] as CatalogExam } : {}),
    ...(goalFilters.length === 1 ? { goal: goalFilters[0] as LearningGoal } : {}),
    sort: sort === 'popular' ? 'hot' : sort === 'latest' ? 'newest' : 'rating',
  }
}

export function filterMarketplaceBooks(
  books: readonly MarketplaceBook[],
  query: string,
  activeCategory: string,
  examFilters: readonly string[],
  goalFilters: readonly string[],
): MarketplaceBook[] {
  const normalized = query.trim().toLowerCase()
  return books.filter((book) => {
    const matchQuery = !normalized || [book.title, book.description, book.author, ...book.exams, ...book.goals].join(' ').toLowerCase().includes(normalized)
    const matchCategory = activeCategory === '全部' || book.exams.includes(activeCategory) || book.goals.includes(activeCategory)
    const matchExam = examFilters.length === 0 || examFilters.some((exam) => book.exams.includes(exam))
    const matchGoal = goalFilters.length === 0 || goalFilters.some((goal) => book.goals.includes(goal))
    return matchQuery && matchCategory && matchExam && matchGoal
  })
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return <label className="filter-check"><input type="checkbox" checked={checked} onChange={onChange} /><span>{label}</span></label>
}

export function MarketplacePage() {
  useDocumentTitle('单词广场')
  const [searchParams, setSearchParams] = useSearchParams()
  const [initialUrlState] = useState(() => readMarketplaceUrlState(searchParams))
  const collection = parseMarketplaceCollection(searchParams.get('collection'))
  const focusId = searchParams.get('focus')
  const [query, setQuery] = useState(initialUrlState.query)
  const [activeCategory, setActiveCategory] = useState(initialUrlState.category)
  const [examFilters, setExamFilters] = useState<string[]>(initialUrlState.examFilters)
  const [goalFilters, setGoalFilters] = useState<string[]>(initialUrlState.goalFilters)
  const [sort, setSort] = useState<MarketplaceSort>(initialUrlState.sort)
  const [view, setView] = useState<MarketplaceView>(initialUrlState.view)
  const [compactFilterLayout, setCompactFilterLayout] = useState(() => (
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(max-width: 640px)').matches
      : false
  ))
  const [filtersExpanded, setFiltersExpanded] = useState(false)
  const [showPublish, setShowPublish] = useState(false)
  const [publishStep, setPublishStep] = useState<PublishStep>('details')
  const [publishForm, setPublishForm] = useState<PublishForm>(EMPTY_PUBLISH_FORM)
  const [personalWordbooks, setPersonalWordbooks] = useState<MyWordbook[]>([])
  const [publishTarget, setPublishTarget] = useState<CatalogWordbook | null>(null)
  const [publishLoading, setPublishLoading] = useState(false)
  const [publishError, setPublishError] = useState('')
  const { user: authUser, loading: authLoading } = useAuth()
  const isLoggedIn = authUser !== null
  const api = getWorkspaceApi()
  const [remoteCatalog, setRemoteCatalog] = useState<CatalogWordbook[] | null>(null)
  // Owner's uploads across every visibility (public catalog omits unlisted/private);
  // null means the endpoint was unavailable and we fall back to the public list.
  const [uploadsCatalog, setUploadsCatalog] = useState<CatalogWordbook[] | null>(null)
  const [favoritesCatalog, setFavoritesCatalog] = useState<CatalogWordbook[] | null>(null)
  const [visibilityUpdatingIds, setVisibilityUpdatingIds] = useState<Set<string>>(() => new Set())
  const [syncMessage, setSyncMessage] = useState('')
  const [loadError, setLoadError] = useState('')
  const publishReturnFocusRef = useRef<HTMLElement | null>(null)
  const publishLoadingRef = useRef(publishLoading)
  publishLoadingRef.current = publishLoading

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(max-width: 640px)')
    const syncLayout = () => setCompactFilterLayout(media.matches)
    syncLayout()
    media.addEventListener('change', syncLayout)
    return () => media.removeEventListener('change', syncLayout)
  }, [])

  useEffect(() => {
    const next = writeMarketplaceUrlState(searchParams, {
      query,
      category: activeCategory,
      examFilters,
      goalFilters,
      sort,
      view,
    })
    if (next.toString() !== searchParams.toString()) setSearchParams(next, { replace: true })
  }, [activeCategory, examFilters, goalFilters, query, searchParams, setSearchParams, sort, view])

  // Sequence counter drops out-of-order responses when filters change quickly.
  const refreshSeq = useRef(0)
  // The text query filters client-side (see `filtered`), so it is deliberately
  // not part of the server request — no per-keystroke network traffic.
  const refreshRemote = useCallback(async () => {
    if (!api) {
      setRemoteCatalog([])
      setUploadsCatalog([])
      setFavoritesCatalog([])
      setLoadError('未配置后端地址，无法读取单词广场。')
      return
    }
    const seq = ++refreshSeq.current
    try {
      const [catalog, uploads, favorites] = await Promise.all([
        api.listCatalog(marketplaceCatalogQuery(examFilters, goalFilters, sort)),
        // The 我的上传 rail needs every own visibility; a missing/erroring endpoint
        // (older server) yields null and the rail falls back to the public list.
        api.listUploads().catch(() => null),
        // Favorites need their dedicated feed: an item can remain favorited after
        // its owner changes it from public to unlisted.
        api.listFavorites().catch(() => null),
      ])
      if (seq !== refreshSeq.current) return
      setRemoteCatalog(catalog)
      setUploadsCatalog(uploads)
      setFavoritesCatalog(favorites)
      setLoadError('')
    } catch {
      if (seq !== refreshSeq.current) return
      setRemoteCatalog([])
      setUploadsCatalog([])
      setFavoritesCatalog([])
      setLoadError('单词广场加载失败，请确认后端服务可用后重试。')
    }
  }, [api, examFilters, goalFilters, sort])

  useEffect(() => { void refreshRemote() }, [refreshRemote])

  useEffect(() => {
    if (!showPublish) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const dialog = () => document.querySelector<HTMLElement>('.market-publish-modal')
    requestAnimationFrame(() => dialog()?.querySelector<HTMLElement>(MODAL_FOCUSABLE)?.focus())
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!publishLoadingRef.current) {
          setShowPublish(false)
          setPublishError('')
        }
        return
      }
      if (event.key !== 'Tab') return
      const focusable = Array.from(dialog()?.querySelectorAll<HTMLElement>(MODAL_FOCUSABLE) ?? [])
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
      publishReturnFocusRef.current?.focus()
    }
  }, [showPublish])

  const activeCatalog = useMemo(() => collection === 'favorites'
    ? (favoritesCatalog ?? (remoteCatalog ?? []).filter((book) => book.favorited))
    : collection === 'uploads'
      ? (uploadsCatalog ?? (remoteCatalog ?? []).filter((book) => book.uploaded))
      : remoteCatalog, [collection, favoritesCatalog, remoteCatalog, uploadsCatalog])
  const books = useMemo(() => {
    const source = [...(activeCatalog ?? [])]
    if (collection !== 'all') {
      source.sort((left, right) => sort === 'latest'
        ? right.createdAt.localeCompare(left.createdAt)
        : sort === 'rating'
          ? right.rating - left.rating
          : right.uses - left.uses)
    }
    return source.map(catalogToMarketplace)
  }, [activeCatalog, collection, sort])
  // Preserve the server's hot/newest/rating order; filtering must never replace
  // "热门" with an unrelated word-count ordering.
  const filtered = useMemo(
    () => filterMarketplaceBooks(books, query, activeCategory, examFilters, goalFilters),
    [activeCategory, books, examFilters, goalFilters, query],
  )
  const hasActiveFilters = Boolean(query.trim() || activeCategory !== '全部' || examFilters.length || goalFilters.length)
  const activeFilterCount = examFilters.length + goalFilters.length
  const filterPanelOpen = !compactFilterLayout || filtersExpanded
  const favoriteIds = useMemo(() => {
    const ids = new Set<string>()
    for (const book of remoteCatalog ?? []) if (book.favorited) ids.add(book.id)
    for (const book of uploadsCatalog ?? []) if (book.favorited) ids.add(book.id)
    for (const book of favoritesCatalog ?? []) ids.add(book.id)
    return ids
  }, [favoritesCatalog, remoteCatalog, uploadsCatalog])
  // Prefer the dedicated own-uploads feed so unlisted/private entries stay manageable;
  // fall back to the public catalog when that endpoint is unavailable.
  const myUploads = (uploadsCatalog ?? (remoteCatalog ?? []).filter((book) => book.uploaded)).map(catalogToMarketplace)
  const myFavorites = (favoritesCatalog ?? (remoteCatalog ?? []).filter((book) => book.favorited)).map(catalogToMarketplace)
  const findOwnUpload = (id: string): CatalogWordbook | null => (uploadsCatalog ?? []).find((book) => book.id === id) ?? remoteCatalog?.find((book) => book.id === id) ?? null
  const selectedSource = personalWordbooks.find((book) => book.id === publishForm.sourceWordbookId)
  const snapshotSourceLocked = isSnapshotSourceLocked(publishTarget?.sourceWordbookId, personalWordbooks)

  useEffect(() => {
    if (!focusId || !filtered.some((book) => book.id === focusId)) return
    window.requestAnimationFrame(() => document.getElementById(`market-book-${focusId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }))
  }, [filtered, focusId])

  function toggleFilter(value: string, setValue: Dispatch<SetStateAction<string[]>>) {
    setValue((values) => values.includes(value) ? values.filter((item) => item !== value) : [...values, value])
  }

  function revealSearchResults() {
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('.market-book-grid, .market-empty')
        ?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    })
  }

  function closePublish() {
    if (publishLoading) return
    setShowPublish(false)
    setPublishError('')
  }

  async function openPublish(target: CatalogWordbook | null = null) {
    if (authLoading) {
      setSyncMessage('正在确认登录状态，请稍候。')
      return
    }
    if (!isLoggedIn) {
      setSyncMessage(UPLOAD_LOGIN_HINT)
      return
    }
    publishReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setShowPublish(true)
    setPublishStep('details')
    setPublishTarget(target)
    setPublishError('')
    setPersonalWordbooks([])
    setPublishLoading(true)
    if (!api) {
      setPublishError('未配置后端，无法读取个人词本。')
      setPublishLoading(false)
      return
    }
    try {
      const wordbooks = await api.listMyWordbooks()
      const available = wordbooks.filter((book) => book.wordCount > 0)
      // Never guess an update source from a mutable display title. New uploads
      // can safely start on the first book; existing uploads use the explicit
      // owner-only source id when available, otherwise require a fresh choice.
      const matchingBook = target
        ? wordbooks.find((book) => book.id === target.sourceWordbookId)
        : available[0]
      // An existing active source is the only safe full-snapshot source. If it no
      // longer exists, expose the remaining books so the owner can explicitly repair it.
      setPersonalWordbooks(target && matchingBook ? [matchingBook] : available)
      // Keep an existing entry's visibility; new uploads default to 公开, falling
      // back to 邀请码 when the user is not logged in (公开 needs an account).
      let visibility: CatalogVisibility = target?.visibility ?? 'public'
      if (!authUser && visibility === 'public') visibility = 'unlisted'
      setPublishForm({
        sourceWordbookId: matchingBook?.id ?? '',
        title: target?.title ?? matchingBook?.title ?? '',
        description: target?.description ?? matchingBook?.description ?? '',
        exam: target?.exams[0] ?? '',
        goal: target?.goals[0] ?? '',
        visibility,
        revisionMessage: target ? '更新词书' : '首次发布',
      })
      if (target && matchingBook && matchingBook.wordCount === 0) setPublishError('原发布源当前没有词条，请先补充词条后再更新快照。')
      else if (!available.length) setPublishError('请先在“我的单词本”创建并导入至少一个非空词本。')
      else if (target && !matchingBook) setPublishError('为避免更新错词本，请重新选择这次快照的来源。')
    } catch {
      setPublishError('个人词本加载失败，请稍后重试。')
    } finally {
      setPublishLoading(false)
    }
  }

  function chooseSourceWordbook(sourceWordbookId: string) {
    if (snapshotSourceLocked && sourceWordbookId !== publishTarget?.sourceWordbookId) return
    setPublishForm((current) => {
      const nextBook = personalWordbooks.find((book) => book.id === sourceWordbookId)
      const previousBook = personalWordbooks.find((book) => book.id === current.sourceWordbookId)
      const title = !current.title || current.title === previousBook?.title ? (nextBook?.title ?? '') : current.title
      const description = !current.description || current.description === previousBook?.description ? (nextBook?.description ?? '') : current.description
      return { ...current, sourceWordbookId, title, description }
    })
  }

  function openPreview() {
    if (!selectedSource) {
      setPublishError('请选择一个非空词本。')
      return
    }
    if (selectedSource.wordCount === 0) {
      setPublishError('原发布源当前没有词条，请先补充词条后再更新快照。')
      return
    }
    if (!publishForm.title.trim()) {
      setPublishError('请填写在广场展示的词库名称。')
      return
    }
    setPublishError('')
    setPublishStep('preview')
  }

  async function submitPublish() {
    if (!api || !selectedSource || !publishForm.title.trim()) return
    if (publishTarget && !publishTarget.headRevisionId) {
      setPublishStep('details')
      setPublishError('当前上传缺少版本信息，请刷新单词广场后重新打开更新窗口。')
      return
    }
    const publishApi = api as typeof api & PublishingWorkspaceApi
    const input: PublishCatalogInput = {
      sourceWordbookId: selectedSource.id,
      ...(publishTarget ? { expectedHeadRevisionId: publishTarget.headRevisionId } : {}),
      title: publishForm.title.trim(),
      description: publishForm.description.trim(),
      exams: publishForm.exam ? [publishForm.exam] : [],
      goals: publishForm.goal ? [publishForm.goal] : [],
      visibility: publishForm.visibility,
      message: publishForm.revisionMessage.trim() || (publishTarget ? '更新词书' : '首次发布'),
    }
    setPublishLoading(true)
    setPublishError('')
    try {
      if (publishTarget) {
        if (!publishApi.updateCatalogSnapshot) throw new Error('update unavailable')
        await publishApi.updateCatalogSnapshot(publishTarget.id, input)
        setSyncMessage(`「${input.title}」的社区快照已更新。已加入的用户词本不会受影响。`)
      } else {
        await api.uploadWordbook(input)
        setSyncMessage(`「${input.title}」已作为独立快照发布到单词广场。`)
      }
      setShowPublish(false)
      await refreshRemote()
    } catch (error) {
      if (error instanceof WorkspaceApiError && (
        error.code === 'CATALOG_HEAD_REQUIRED'
        || error.code === 'CATALOG_HEAD_STALE'
        || error.code === 'CATALOG_SOURCE_MISMATCH'
      )) {
        setShowPublish(false)
        setPublishTarget(null)
        await refreshRemote()
        setSyncMessage(error.code === 'CATALOG_SOURCE_MISMATCH'
          ? '快照未更新：该上传已绑定另一发布源，请重新打开并使用原发布源。'
          : '快照未更新：广场版本已经变化，请重新打开更新窗口确认最新内容。')
      } else if (input.visibility === 'public' && isAuthRequiredError(error)) {
        setPublishStep('details')
        setPublishError(UPLOAD_LOGIN_HINT)
      } else {
        setPublishError('发布失败，请确认后端服务已更新后重试。')
      }
    } finally {
      setPublishLoading(false)
    }
  }

  async function importShareCode() {
    const code = window.prompt('输入分享码')?.trim()
    if (!code) return
    if (api) {
      try {
        const result = await api.importShareCode(code)
        await refreshRemote()
        setSyncMessage(`已导入「${result.wordbook.title}」。`)
        return
      } catch {
        setSyncMessage('分享码未能同步，请检查后重试。')
        return
      }
    }
    setSyncMessage('未配置后端，无法导入分享码。')
  }

  async function toggleFavorite(id: string) {
    if (!api) return
    try { await api.toggleFavorite(id); await refreshRemote() } catch { setSyncMessage('收藏操作失败，请稍后重试。') }
  }

  async function joinBook(book: MarketplaceBook) {
    if (!api) return
    try { await api.addCatalog(book.id); await refreshRemote(); setSyncMessage(`已加入「${book.title}」。`) } catch { setSyncMessage('加入词本失败，请稍后重试。') }
  }

  async function deleteUpload(book: MarketplaceBook) {
    if (!api) return
    if (!window.confirm(`从广场删除「${book.title}」？已被其他人加入的副本不受影响。`)) return
    // refreshRemote drives both the main catalog grid and the derived 我的上传/收藏 rails,
    // and carries the refreshSeq request-race guard.
    try { await api.deleteCatalogUpload(book.id); await refreshRemote(); setSyncMessage(`已从广场删除「${book.title}」。`) } catch { setSyncMessage('删除失败，请稍后重试。') }
  }

  async function copyShareCode(book: MarketplaceBook) {
    const code = book.shareCode
    if (!code) {
      setSyncMessage('该上传暂无可用邀请码，请刷新后重试。')
      return
    }
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(code)
      setSyncMessage(`邀请码已复制：${code}`)
    } catch {
      // Insecure contexts (and browsers without the async clipboard API) fall
      // back to a prompt the user can copy from manually.
      window.prompt('复制邀请码', code)
    }
  }

  async function changeVisibility(book: MarketplaceBook, visibility: CatalogVisibility) {
    if (!api || book.visibility === visibility || visibilityUpdatingIds.has(book.id)) return
    if (visibility === 'public' && !isLoggedIn) {
      setSyncMessage(UPLOAD_LOGIN_HINT)
      return
    }
    setVisibilityUpdatingIds((ids) => new Set(ids).add(book.id))
    try {
      await api.updateCatalogSnapshot(book.id, { visibility })
      await refreshRemote()
      setSyncMessage(`「${book.title}」已设为${VISIBILITY_LABELS[visibility]}。`)
    } catch (error) {
      if (isAuthRequiredError(error)) setSyncMessage(UPLOAD_LOGIN_HINT)
      else setSyncMessage('可见性更新失败，请稍后重试。')
    } finally {
      setVisibilityUpdatingIds((ids) => {
        const next = new Set(ids)
        next.delete(book.id)
        return next
      })
    }
  }

  return (
    <section className="marketplace-page" aria-labelledby="marketplace-title">
      <div className="marketplace-hero">
        <div><h1 id="marketplace-title">共享单词本广场</h1><p>发现、收藏、分享你的词汇体系</p></div>
        <div className="marketplace-tools">
          <form className="market-search" role="search" onSubmit={(event) => { event.preventDefault(); revealSearchResults() }}>
            <label className="sr-only" htmlFor="marketplace-search">搜索词库</label>
            <input id="marketplace-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索词库 / 标签 / 作者" />
            <button type="submit" aria-label="查看搜索结果"><MarketplaceIcon name="search" /></button>
          </form>
          {isLoggedIn && <button className="market-primary" type="button" onClick={() => void openPublish()}><MarketplaceIcon name="plus" />上传我的词库</button>}
          <button className="market-secondary" type="button" onClick={importShareCode}><MarketplaceIcon name="share" />从分享码导入</button>
        </div>
        <div className="hero-books" aria-hidden="true"><span /><span /><span /></div>
      </div>

      <div className="marketplace-layout">
        <aside className={`market-filter${filtersExpanded ? ' is-expanded' : ''}`} aria-label="分类筛选">
          <div className="market-filter-heading">
            <h2>
              <MarketplaceIcon name="filter" />
              分类筛选
              {activeFilterCount > 0 && (
                <span className="market-filter-count" aria-label={`${activeFilterCount} 项筛选条件`}>
                  {activeFilterCount}
                </span>
              )}
            </h2>
            <button
              className="market-filter-toggle"
              type="button"
              aria-expanded={filterPanelOpen}
              aria-controls="market-filter-options"
              onClick={() => setFiltersExpanded((expanded) => !expanded)}
            >
              {filtersExpanded ? '收起' : '展开'}
              <span className="market-filter-chevron" aria-hidden="true">⌄</span>
            </button>
          </div>
          <div id="market-filter-options" className="market-filter-options" hidden={!filterPanelOpen}>
            <div className="market-filter-options-inner">
              <fieldset><legend>考试类型</legend><div className="filter-grid"><Toggle label="IELTS" checked={examFilters.includes('IELTS')} onChange={() => toggleFilter('IELTS', setExamFilters)} /><Toggle label="TOEFL" checked={examFilters.includes('TOEFL')} onChange={() => toggleFilter('TOEFL', setExamFilters)} /><Toggle label="GRE" checked={examFilters.includes('GRE')} onChange={() => toggleFilter('GRE', setExamFilters)} /><Toggle label="高考" checked={examFilters.includes('高考')} onChange={() => toggleFilter('高考', setExamFilters)} /><Toggle label="四级" checked={examFilters.includes('四级')} onChange={() => toggleFilter('四级', setExamFilters)} /><Toggle label="六级" checked={examFilters.includes('六级')} onChange={() => toggleFilter('六级', setExamFilters)} /></div></fieldset>
              <fieldset><legend>学习目标</legend><div className="filter-grid"><Toggle label="写作" checked={goalFilters.includes('写作')} onChange={() => toggleFilter('写作', setGoalFilters)} /><Toggle label="阅读" checked={goalFilters.includes('阅读')} onChange={() => toggleFilter('阅读', setGoalFilters)} /><Toggle label="听力" checked={goalFilters.includes('听力')} onChange={() => toggleFilter('听力', setGoalFilters)} /><Toggle label="口语" checked={goalFilters.includes('口语')} onChange={() => toggleFilter('口语', setGoalFilters)} /></div></fieldset>
              <fieldset><legend>排序方式</legend><div className="filter-radio">{([['popular', '热门'], ['latest', '最近更新'], ['rating', '评分最高']] as const).map(([value, label]) => <label key={value}><input type="radio" name="market-sort" checked={sort === value} onChange={() => setSort(value)} />{label}</label>)}</div></fieldset>
              <button className="clear-filters" type="button" onClick={() => { setExamFilters([]); setGoalFilters([]); setActiveCategory('全部'); setQuery('') }}>清空筛选</button>
            </div>
          </div>
        </aside>

        <div className="market-content">
          {(syncMessage || loadError) && <p className="market-sync-note" role="status">{syncMessage || loadError}</p>}
          {collection !== 'all' && <div className="market-collection-heading"><div><p className="marginal">个人集合</p><h2>{collection === 'favorites' ? '我的全部收藏' : '我的全部上传'}</h2></div><Link to="/marketplace">返回全部词库</Link></div>}
          <div className="market-toolbar"><div className="category-tabs" role="tablist" aria-label="词库类别">{MARKETPLACE_CATEGORIES.map((category) => <button key={category} type="button" role="tab" aria-selected={activeCategory === category} className={activeCategory === category ? 'active' : ''} onClick={() => setActiveCategory(category)}>{category}</button>)}</div><div className="view-controls"><select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} aria-label="排序"><option value="popular">推荐排序</option><option value="latest">最近更新</option><option value="rating">评分最高</option></select><button className={view === 'grid' ? 'active' : ''} type="button" aria-label="网格视图" onClick={() => setView('grid')}><MarketplaceIcon name="grid" /></button><button className={view === 'list' ? 'active' : ''} type="button" aria-label="列表视图" onClick={() => setView('list')}><MarketplaceIcon name="list" /></button></div></div>
          {activeCatalog === null ? (
            <div className="market-empty"><h2>正在加载词库</h2></div>
          ) : filtered.length ? (
            <div className={`market-book-grid ${view === 'list' ? 'list-view' : ''}`}>
              {filtered.map((book) => (
                <article id={`market-book-${book.id}`} className={`market-book-card${focusId === book.id ? ' is-focused' : ''}`} key={book.id}>
                  <Link
                    className="market-card-detail-link"
                    to={marketplaceDetailHref(book.id, searchParams.toString())}
                    aria-label={`查看「${book.title}」概况`}
                  />
                  <div className="market-card-cover"><BookCover tone={book.tone} label={book.shortLabel} /></div>
                  <div className="market-card-body">
                    <h2>{book.title}</h2>
                    <p>{book.description}</p>
                    <small>作者：{book.author}</small>
                    <div className="market-metrics">
                      <span><MarketplaceIcon name="book" />{book.wordCount}词</span>
                      <span><MarketplaceIcon name="heart" />{book.favoriteCount}</span>
                      <span><MarketplaceIcon name="people" />{book.learners}</span>
                    </div>
                    {book.uploaded && book.visibility && (
                      <div className="market-own-meta">
                        <span className={`visibility-badge visibility-${book.visibility}`}>{VISIBILITY_LABELS[book.visibility]}</span>
                        {book.visibility === 'unlisted' && <button type="button" className="copy-invite" onClick={() => void copyShareCode(book)}>复制邀请码</button>}
                      </div>
                    )}
                    <div className="market-card-actions">
                      <button type="button" className={favoriteIds.has(book.id) ? 'liked' : ''} aria-label="切换收藏" onClick={() => void toggleFavorite(book.id)}><MarketplaceIcon name="heart" /></button>
                      {book.uploaded ? (
                        <span className="market-upload-actions">
                          <button type="button" className="refresh-snapshot" onClick={() => void openPublish(findOwnUpload(book.id))}><MarketplaceIcon name="refresh" />更新快照</button>
                          <button type="button" className="delete-upload" onClick={() => void deleteUpload(book)}>删除</button>
                        </span>
                      ) : (
                        <button type="button" className="join-book" onClick={() => void joinBook(book)}>{book.added ? '已加入词本' : '加入词本'}</button>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="market-empty">
              <h2>{loadError ? '单词广场加载失败' : hasActiveFilters ? '没有找到匹配的词库' : collection === 'favorites' ? '还没有收藏词库' : collection === 'uploads' ? '还没有上传词库' : '单词广场还是空的'}</h2>
              <p>{loadError || (hasActiveFilters ? '试试放宽筛选条件。' : collection === 'favorites' ? '在广场点击爱心后，收藏会出现在这里。' : collection === 'uploads' ? '上传个人词本后，可在这里统一管理。' : isLoggedIn ? '上传第一本共享词库，或使用分享码导入。' : '使用分享码导入词库；登录后可分享自己的词库。')}</p>
              {loadError || hasActiveFilters ? <button type="button" onClick={() => void refreshRemote()}>重新加载</button> : collection === 'all' && isLoggedIn ? <button type="button" onClick={() => void openPublish()}>上传第一本词库</button> : null}
            </div>
          )}
          <div className="market-collections">
            <Collection title="我的收藏" icon="star" collection="favorites" books={myFavorites} favorites={favoriteIds} onToggleFavorite={(id) => void toggleFavorite(id)} />
            {isLoggedIn && <Collection
              title="我的上传"
              icon="cloud"
              collection="uploads"
              books={myUploads}
              favorites={favoriteIds}
              canPublishPublic={isLoggedIn}
              updatingVisibilityIds={visibilityUpdatingIds}
              onToggleFavorite={(id) => void toggleFavorite(id)}
              onUpdate={(id) => void openPublish(findOwnUpload(id))}
              onDelete={(id) => { const book = myUploads.find((item) => item.id === id); if (book) void deleteUpload(book) }}
              onCopyInvite={(id) => { const book = myUploads.find((item) => item.id === id); if (book) void copyShareCode(book) }}
              onSetVisibility={(id, visibility) => { const book = myUploads.find((item) => item.id === id); if (book) void changeVisibility(book, visibility) }}
            />}
          </div>
        </div>
      </div>

      {showPublish && <div className="market-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closePublish() }}><section className="market-modal market-publish-modal" role="dialog" aria-modal="true" aria-labelledby="publish-title"><button className="modal-close" type="button" aria-label="关闭" onClick={closePublish}>×</button>{publishLoading && !personalWordbooks.length ? <p className="publish-loading" role="status">正在读取你的个人词本…</p> : <>{publishStep === 'details' ? <><p className="marginal">{publishTarget ? '更新社区快照' : '新建共享词库'}</p><h2 id="publish-title">{publishTarget ? '更新我的上传' : '发布我的词本'}</h2><p>选择词本并填写展示信息。发布的是独立快照，之后修改个人词本不会影响已发布内容。</p><label>选择个人词本<select value={publishForm.sourceWordbookId} onChange={(event) => chooseSourceWordbook(event.target.value)} disabled={!personalWordbooks.length}><option value="">请选择非空词本</option>{personalWordbooks.map((book) => <option key={book.id} value={book.id}>{book.title}（{book.wordCount} 词）</option>)}</select></label>{publishTarget && !publishForm.sourceWordbookId && <p className="publish-source-hint">为避免覆盖错词本，请明确选择这次快照的来源。</p>}<label>社区展示名称<input value={publishForm.title} maxLength={80} onChange={(event) => setPublishForm((current) => ({ ...current, title: event.target.value }))} placeholder="例如：7 月阅读积累" autoFocus /></label><label>简介<textarea value={publishForm.description} maxLength={240} onChange={(event) => setPublishForm((current) => ({ ...current, description: event.target.value }))} placeholder="告诉大家这本词库适合什么场景。" /></label><label>版本说明<input value={publishForm.revisionMessage} maxLength={80} onChange={(event) => setPublishForm((current) => ({ ...current, revisionMessage: event.target.value }))} placeholder={publishTarget ? '例如：补充 7 月阅读词条' : '首次发布'} /></label><div className="publish-meta-fields"><label>考试类型<select value={publishForm.exam} onChange={(event) => setPublishForm((current) => ({ ...current, exam: event.target.value }))}><option value="">不设置</option>{PUBLISH_EXAMS.map((exam) => <option key={exam}>{exam}</option>)}</select></label><label>学习目标<select value={publishForm.goal} onChange={(event) => setPublishForm((current) => ({ ...current, goal: event.target.value }))}><option value="">不设置</option>{PUBLISH_GOALS.map((goal) => <option key={goal}>{goal}</option>)}</select></label></div><fieldset className="publish-visibility"><legend>可见性</legend>{VISIBILITY_OPTIONS.map((option) => { const optionDisabled = option.value === 'public' && !isLoggedIn; return <label key={option.value} className={optionDisabled ? 'is-disabled' : ''}><input type="radio" name="publish-visibility" value={option.value} checked={publishForm.visibility === option.value} disabled={optionDisabled} onChange={() => setPublishForm((current) => ({ ...current, visibility: option.value }))} /><span><strong>{option.label}</strong><small>{option.hint}</small></span></label> })}{!isLoggedIn && <p className="visibility-hint">{UPLOAD_LOGIN_HINT}</p>}</fieldset>{publishError && <p className="publish-error" role="alert">{publishError}</p>}<div className="publish-actions"><button className="market-secondary" type="button" onClick={closePublish}>取消</button><button className="market-primary" type="button" disabled={!personalWordbooks.length} onClick={openPreview}>预览发布</button></div></> : <><p className="marginal">发布预览</p><h2 id="publish-title">确认社区快照</h2><div className="publish-preview"><BookCover tone="blue" label={(publishForm.exam || publishForm.title.slice(0, 5)).toUpperCase()} /><div><strong>{publishForm.title}</strong><span>{selectedSource?.wordCount ?? 0} 词 · {selectedSource?.title}</span><p>{publishForm.description || '暂无简介'}</p><small>{[publishForm.exam, publishForm.goal].filter(Boolean).join(' · ') || '未设置分类'}</small><small>版本说明：{publishForm.revisionMessage || (publishTarget ? '更新词书' : '首次发布')}</small><small>可见性：{VISIBILITY_LABELS[publishForm.visibility]}</small></div></div><p>确认后，社区会保存这本词本的当前副本。以后主动更新快照，也不会改动其他用户已加入的词本。</p>{publishError && <p className="publish-error" role="alert">{publishError}</p>}<div className="publish-actions"><button className="market-secondary" type="button" disabled={publishLoading} onClick={() => setPublishStep('details')}>返回修改</button><button className="market-primary" type="button" disabled={publishLoading} onClick={() => void submitPublish()}>{publishLoading ? '正在发布…' : publishTarget ? '更新社区快照' : '确认发布'}</button></div></>}</>}</section></div>}
    </section>
  )
}

type CollectionProps = {
  title: string
  icon: 'star' | 'cloud'
  collection: 'favorites' | 'uploads'
  books: MarketplaceBook[]
  favorites: Set<string>
  canPublishPublic?: boolean
  updatingVisibilityIds?: Set<string>
  onToggleFavorite: (id: string) => void
  onUpdate?: (id: string) => void
  onDelete?: (id: string) => void
  onCopyInvite?: (id: string) => void
  onSetVisibility?: (id: string, visibility: CatalogVisibility) => void
}

function Collection({ title, icon, collection, books, favorites, canPublishPublic = false, updatingVisibilityIds = new Set(), onToggleFavorite, onUpdate, onDelete, onCopyInvite, onSetVisibility }: CollectionProps) {
  const pending = books.reduce((total, book) => total + (book.openContributionCount ?? 0), 0)
  return <section className="mini-collection"><header><h2><MarketplaceIcon name={icon} />{title}</h2><span className="collection-header-links">{collection === 'uploads' && <Link to="/marketplace/contributions">协作 {pending}</Link>}<Link to={`/marketplace?collection=${collection}`}>查看全部 ›</Link></span></header>{books.length ? <div>{books.slice(0, 2).map((book) => <article key={book.id}><BookCover tone={book.tone} label={book.shortLabel} /><span><strong>{book.title}</strong><small>{book.wordCount || '新建'}词 ｜ {book.author}</small>{(onUpdate || onDelete || onCopyInvite || (onSetVisibility && book.visibility)) && <span className="collection-manage">{onSetVisibility && book.visibility && <select className="collection-visibility" value={book.visibility} aria-label={`修改「${book.title}」的可见性`} disabled={updatingVisibilityIds.has(book.id)} onChange={(event) => onSetVisibility(book.id, event.target.value as CatalogVisibility)}>{VISIBILITY_OPTIONS.map((option) => <option key={option.value} value={option.value} disabled={option.value === 'public' && !canPublishPublic}>{option.label}</option>)}</select>}{onCopyInvite && book.visibility === 'unlisted' && <button className="collection-copy-invite" type="button" onClick={() => onCopyInvite(book.id)}>复制邀请码</button>}{onUpdate && <button className="collection-update" type="button" onClick={() => onUpdate(book.id)}>更新快照</button>}{onDelete && <button className="collection-delete" type="button" onClick={() => onDelete(book.id)}>删除</button>}</span>}</span><button type="button" className={favorites.has(book.id) ? 'liked' : ''} aria-label="切换收藏" onClick={() => onToggleFavorite(book.id)}><MarketplaceIcon name="heart" /></button></article>)}</div> : <p className="collection-empty">还没有内容，去发现一本喜欢的词库吧。</p>}</section>
}
