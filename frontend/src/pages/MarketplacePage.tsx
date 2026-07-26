import { useCallback, useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { Link } from 'react-router-dom'
import {
  getWorkspaceApi,
  type CatalogExam,
  type CatalogWordbook,
  type LearningGoal,
  type MyWordbook,
} from '../data/workspaceApi'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

type IconName = 'search' | 'filter' | 'plus' | 'share' | 'grid' | 'list' | 'book' | 'star' | 'people' | 'heart' | 'cloud' | 'refresh'
type CoverTone = 'blue' | 'amber' | 'green' | 'lavender' | 'rose' | 'slate'
type MarketplaceBook = {
  id: string
  title: string
  description: string
  author: string
  wordCount: number
  rating: number
  learners: string
  category: string
  exam: string
  tone: CoverTone
  shortLabel: string
  uploaded: boolean
}
type PublishStep = 'details' | 'preview'
type PublishForm = {
  sourceWordbookId: string
  title: string
  description: string
  exam: string
  goal: string
}
type PublishCatalogInput = {
  sourceWordbookId: string
  title: string
  description: string
  exams: string[]
  goals: string[]
}
type PublishingWorkspaceApi = {
  updateCatalogSnapshot?: (catalogId: string, input: PublishCatalogInput) => Promise<unknown>
}

const MARKETPLACE_CATEGORIES = ['全部', 'IELTS', 'TOEFL', 'GRE', '高考', '四六级', '考研', '写作', '阅读', '听力', '口语']
const PUBLISH_EXAMS = ['IELTS', 'TOEFL', 'GRE', '高考', '四六级', '考研']
const PUBLISH_GOALS = ['写作', '阅读', '听力', '口语']
const EMPTY_PUBLISH_FORM: PublishForm = { sourceWordbookId: '', title: '', description: '', exam: '', goal: '' }

function MarketplaceIcon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
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
  return <svg className="market-icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>
}

function BookCover({ tone, label }: { tone: CoverTone; label: string }) {
  return <div className={`book-cover cover-${tone}`} aria-hidden="true"><span>{label}</span><i /></div>
}

function catalogToMarketplace(book: CatalogWordbook, index: number): MarketplaceBook {
  const tones: CoverTone[] = ['blue', 'amber', 'green', 'rose', 'lavender', 'slate']
  const category = book.goals[0] ?? book.exams[0] ?? '全部'
  return {
    id: book.id,
    title: book.title,
    description: book.description,
    author: book.author,
    wordCount: book.wordCount,
    rating: book.rating,
    learners: book.uses >= 10_000 ? `${(book.uses / 10_000).toFixed(1)}万人使用` : `${book.uses}人使用`,
    category,
    exam: book.exams[0] ?? '',
    tone: tones[index % tones.length],
    shortLabel: (book.exams[0] ?? book.title.slice(0, 5)).toUpperCase(),
    uploaded: book.uploaded,
  }
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return <label className="filter-check"><input type="checkbox" checked={checked} onChange={onChange} /><span>{label}</span></label>
}

export function MarketplacePage() {
  useDocumentTitle('单词广场')
  const [query, setQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState('全部')
  const [examFilters, setExamFilters] = useState<string[]>([])
  const [goalFilters, setGoalFilters] = useState<string[]>([])
  const [sort, setSort] = useState<'popular' | 'latest' | 'rating'>('popular')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [showPublish, setShowPublish] = useState(false)
  const [publishStep, setPublishStep] = useState<PublishStep>('details')
  const [publishForm, setPublishForm] = useState<PublishForm>(EMPTY_PUBLISH_FORM)
  const [personalWordbooks, setPersonalWordbooks] = useState<MyWordbook[]>([])
  const [publishTarget, setPublishTarget] = useState<CatalogWordbook | null>(null)
  const [publishLoading, setPublishLoading] = useState(false)
  const [publishError, setPublishError] = useState('')
  const api = getWorkspaceApi()
  const [remoteCatalog, setRemoteCatalog] = useState<CatalogWordbook[] | null>(null)
  const [syncMessage, setSyncMessage] = useState('')
  const [loadError, setLoadError] = useState('')

  const refreshRemote = useCallback(async () => {
    if (!api) {
      setRemoteCatalog([])
      setLoadError('未配置后端地址，无法读取单词广场。')
      return
    }
    try {
      const catalog = await api.listCatalog({
        q: query.trim() || undefined,
        exam: examFilters[0] as CatalogExam | undefined,
        goal: goalFilters[0] as LearningGoal | undefined,
        sort: sort === 'popular' ? 'hot' : sort === 'latest' ? 'newest' : 'rating',
      })
      setRemoteCatalog(catalog)
      setLoadError('')
    } catch {
      setRemoteCatalog([])
      setLoadError('单词广场加载失败，请确认后端服务可用后重试。')
    }
  }, [api, examFilters, goalFilters, query, sort])

  useEffect(() => { void refreshRemote() }, [refreshRemote])

  const books = useMemo(() => (remoteCatalog ?? []).map(catalogToMarketplace), [remoteCatalog])
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    const result = books.filter((book) => {
      const matchQuery = !normalized || [book.title, book.description, book.author, book.category].join(' ').toLowerCase().includes(normalized)
      const matchCategory = activeCategory === '全部' || book.category === activeCategory || book.exam === activeCategory
      const matchExam = examFilters.length === 0 || examFilters.includes(book.exam)
      const matchGoal = goalFilters.length === 0 || goalFilters.includes(book.category)
      return matchQuery && matchCategory && matchExam && matchGoal
    })
    return result.sort((a, b) => {
      if (sort === 'rating') return b.rating - a.rating
      if (sort === 'latest') return 0
      return b.wordCount - a.wordCount
    })
  }, [activeCategory, books, examFilters, goalFilters, query, sort])
  const hasActiveFilters = Boolean(query.trim() || activeCategory !== '全部' || examFilters.length || goalFilters.length)
  const favoriteIds = useMemo(() => new Set(remoteCatalog?.filter((book) => book.favorited).map((book) => book.id) ?? []), [remoteCatalog])
  const myUploads = (remoteCatalog ?? []).filter((book) => book.uploaded).map(catalogToMarketplace)
  const myFavorites = (remoteCatalog ?? []).filter((book) => book.favorited).map(catalogToMarketplace)
  const selectedSource = personalWordbooks.find((book) => book.id === publishForm.sourceWordbookId)

  function toggleFilter(value: string, setValue: Dispatch<SetStateAction<string[]>>) {
    setValue((values) => values.includes(value) ? values.filter((item) => item !== value) : [...values, value])
  }

  function closePublish() {
    if (publishLoading) return
    setShowPublish(false)
    setPublishError('')
  }

  async function openPublish(target: CatalogWordbook | null = null) {
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
      const available = (await api.listMyWordbooks()).filter((book) => book.wordCount > 0)
      setPersonalWordbooks(available)
      const matchingBook = available.find((book) => book.title === target?.title) ?? available[0]
      setPublishForm({
        sourceWordbookId: matchingBook?.id ?? '',
        title: target?.title ?? matchingBook?.title ?? '',
        description: target?.description ?? matchingBook?.description ?? '',
        exam: target?.exams[0] ?? '',
        goal: target?.goals[0] ?? '',
      })
      if (!available.length) setPublishError('请先在“我的单词本”创建并导入至少一个非空词本。')
    } catch {
      setPublishError('个人词本加载失败，请稍后重试。')
    } finally {
      setPublishLoading(false)
    }
  }

  function chooseSourceWordbook(sourceWordbookId: string) {
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
    if (!publishForm.title.trim()) {
      setPublishError('请填写在广场展示的词库名称。')
      return
    }
    setPublishError('')
    setPublishStep('preview')
  }

  async function submitPublish() {
    if (!api || !selectedSource || !publishForm.title.trim()) return
    const publishApi = api as typeof api & PublishingWorkspaceApi
    const input: PublishCatalogInput = {
      sourceWordbookId: selectedSource.id,
      title: publishForm.title.trim(),
      description: publishForm.description.trim(),
      exams: publishForm.exam ? [publishForm.exam] : [],
      goals: publishForm.goal ? [publishForm.goal] : [],
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
    } catch {
      setPublishError('发布失败，请确认后端服务已更新后重试。')
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

  async function toggleFavorite(book: MarketplaceBook) {
    if (!api) return
    try { await api.toggleFavorite(book.id); await refreshRemote() } catch { setSyncMessage('收藏操作失败，请稍后重试。') }
  }

  async function joinBook(book: MarketplaceBook) {
    if (!api) return
    try { await api.addCatalog(book.id); await refreshRemote(); setSyncMessage(`已加入「${book.title}」。`) } catch { setSyncMessage('加入词本失败，请稍后重试。') }
  }

  return (
    <section className="marketplace-page" aria-labelledby="marketplace-title">
      <div className="marketplace-hero">
        <div><h1 id="marketplace-title">共享单词本广场</h1><p>发现、收藏、分享你的词汇体系</p></div>
        <div className="marketplace-tools">
          <label className="market-search"><span className="sr-only">搜索词库</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索词库 / 标签 / 作者" /><button type="button" aria-label="搜索"><MarketplaceIcon name="search" /></button></label>
          <button className="market-primary" type="button" onClick={() => void openPublish()}><MarketplaceIcon name="plus" />上传我的词库</button>
          <button className="market-secondary" type="button" onClick={importShareCode}><MarketplaceIcon name="share" />从分享码导入</button>
        </div>
        <div className="hero-books" aria-hidden="true"><span /><span /><span /></div>
      </div>

      <div className="marketplace-layout">
        <aside className="market-filter" aria-label="分类筛选">
          <h2><MarketplaceIcon name="filter" />分类筛选</h2>
          <fieldset><legend>考试类型</legend><div className="filter-grid"><Toggle label="IELTS" checked={examFilters.includes('IELTS')} onChange={() => toggleFilter('IELTS', setExamFilters)} /><Toggle label="TOEFL" checked={examFilters.includes('TOEFL')} onChange={() => toggleFilter('TOEFL', setExamFilters)} /><Toggle label="GRE" checked={examFilters.includes('GRE')} onChange={() => toggleFilter('GRE', setExamFilters)} /><Toggle label="高考" checked={examFilters.includes('高考')} onChange={() => toggleFilter('高考', setExamFilters)} /><Toggle label="四六级" checked={examFilters.includes('四六级')} onChange={() => toggleFilter('四六级', setExamFilters)} /></div></fieldset>
          <fieldset><legend>学习目标</legend><div className="filter-grid"><Toggle label="写作" checked={goalFilters.includes('写作')} onChange={() => toggleFilter('写作', setGoalFilters)} /><Toggle label="阅读" checked={goalFilters.includes('阅读')} onChange={() => toggleFilter('阅读', setGoalFilters)} /><Toggle label="听力" checked={goalFilters.includes('听力')} onChange={() => toggleFilter('听力', setGoalFilters)} /><Toggle label="口语" checked={goalFilters.includes('口语')} onChange={() => toggleFilter('口语', setGoalFilters)} /></div></fieldset>
          <fieldset><legend>排序方式</legend><div className="filter-radio">{([['popular', '热门'], ['latest', '最新'], ['rating', '评分最高']] as const).map(([value, label]) => <label key={value}><input type="radio" name="market-sort" checked={sort === value} onChange={() => setSort(value)} />{label}</label>)}</div></fieldset>
          <button className="clear-filters" type="button" onClick={() => { setExamFilters([]); setGoalFilters([]); setActiveCategory('全部'); setQuery('') }}>清空筛选</button>
        </aside>

        <div className="market-content">
          {(syncMessage || loadError) && <p className="market-sync-note" role="status">{syncMessage || loadError}</p>}
          <div className="market-toolbar"><div className="category-tabs" role="tablist" aria-label="词库类别">{MARKETPLACE_CATEGORIES.map((category) => <button key={category} type="button" role="tab" aria-selected={activeCategory === category} className={activeCategory === category ? 'active' : ''} onClick={() => setActiveCategory(category)}>{category}</button>)}</div><div className="view-controls"><select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} aria-label="排序"><option value="popular">推荐排序</option><option value="latest">最新上传</option><option value="rating">评分最高</option></select><button className={view === 'grid' ? 'active' : ''} type="button" aria-label="网格视图" onClick={() => setView('grid')}><MarketplaceIcon name="grid" /></button><button className={view === 'list' ? 'active' : ''} type="button" aria-label="列表视图" onClick={() => setView('list')}><MarketplaceIcon name="list" /></button></div></div>
          {remoteCatalog === null ? <div className="market-empty"><h2>正在加载词库</h2></div> : filtered.length ? <div className={`market-book-grid ${view === 'list' ? 'list-view' : ''}`}>{filtered.map((book) => <article className="market-book-card" key={book.id}><div className="market-card-cover"><BookCover tone={book.tone} label={book.shortLabel} /></div><div className="market-card-body"><h2>{book.title}</h2><p>{book.description}</p><small>作者：{book.author}</small><div className="market-metrics"><span><MarketplaceIcon name="book" />{book.wordCount}词</span><span><MarketplaceIcon name="star" />{book.rating}</span><span><MarketplaceIcon name="people" />{book.learners}</span></div><div className="market-card-actions"><button type="button" className={favoriteIds.has(book.id) ? 'liked' : ''} aria-label="切换收藏" onClick={() => void toggleFavorite(book)}><MarketplaceIcon name="heart" /></button>{book.uploaded ? <button type="button" className="refresh-snapshot" onClick={() => void openPublish(remoteCatalog.find((item) => item.id === book.id) ?? null)}><MarketplaceIcon name="refresh" />更新快照</button> : <button type="button" className="join-book" onClick={() => void joinBook(book)}>{remoteCatalog.find((item) => item.id === book.id)?.added ? '已加入词本' : '加入词本'}</button>}</div></div></article>)}</div> : <div className="market-empty"><h2>{loadError ? '单词广场加载失败' : hasActiveFilters ? '没有找到匹配的词库' : '单词广场还是空的'}</h2><p>{loadError || (hasActiveFilters ? '试试放宽筛选条件。' : '上传第一本共享词库，或使用分享码导入。')}</p>{loadError || hasActiveFilters ? <button type="button" onClick={() => void refreshRemote()}>重新加载</button> : <button type="button" onClick={() => void openPublish()}>上传第一本词库</button>}</div>}
          <div className="market-collections"><Collection title="我的收藏" icon="star" books={myFavorites} favorites={favoriteIds} onToggleFavorite={(id) => { const book = books.find((item) => item.id === id); if (book) void toggleFavorite(book) }} /><Collection title="我的上传" icon="cloud" books={myUploads} favorites={favoriteIds} onToggleFavorite={(id) => { const book = books.find((item) => item.id === id); if (book) void toggleFavorite(book) }} onUpdate={(id) => void openPublish(remoteCatalog?.find((book) => book.id === id) ?? null)} /></div>
        </div>
      </div>

      {showPublish && <div className="market-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closePublish() }}><section className="market-modal market-publish-modal" role="dialog" aria-modal="true" aria-labelledby="publish-title"><button className="modal-close" type="button" aria-label="关闭" onClick={closePublish}>×</button>{publishLoading && !personalWordbooks.length ? <p className="publish-loading" role="status">正在读取你的个人词本…</p> : <>{publishStep === 'details' ? <><p className="marginal">{publishTarget ? '更新社区快照' : '新建共享词库'}</p><h2 id="publish-title">{publishTarget ? '更新我的上传' : '发布我的词本'}</h2><p>选择词本并填写展示信息。发布的是独立快照，之后修改个人词本不会影响已发布内容。</p><label>选择个人词本<select value={publishForm.sourceWordbookId} onChange={(event) => chooseSourceWordbook(event.target.value)} disabled={!personalWordbooks.length}><option value="">请选择非空词本</option>{personalWordbooks.map((book) => <option key={book.id} value={book.id}>{book.title}（{book.wordCount} 词）</option>)}</select></label><label>社区展示名称<input value={publishForm.title} maxLength={80} onChange={(event) => setPublishForm((current) => ({ ...current, title: event.target.value }))} placeholder="例如：7 月阅读积累" autoFocus /></label><label>简介<textarea value={publishForm.description} maxLength={240} onChange={(event) => setPublishForm((current) => ({ ...current, description: event.target.value }))} placeholder="告诉大家这本词库适合什么场景。" /></label><div className="publish-meta-fields"><label>考试类型<select value={publishForm.exam} onChange={(event) => setPublishForm((current) => ({ ...current, exam: event.target.value }))}><option value="">不设置</option>{PUBLISH_EXAMS.map((exam) => <option key={exam}>{exam}</option>)}</select></label><label>学习目标<select value={publishForm.goal} onChange={(event) => setPublishForm((current) => ({ ...current, goal: event.target.value }))}><option value="">不设置</option>{PUBLISH_GOALS.map((goal) => <option key={goal}>{goal}</option>)}</select></label></div>{publishError && <p className="publish-error" role="alert">{publishError}</p>}<div className="publish-actions"><button className="market-secondary" type="button" onClick={closePublish}>取消</button><button className="market-primary" type="button" disabled={!personalWordbooks.length} onClick={openPreview}>预览发布</button></div></> : <><p className="marginal">发布预览</p><h2 id="publish-title">确认社区快照</h2><div className="publish-preview"><BookCover tone="blue" label={(publishForm.exam || publishForm.title.slice(0, 5)).toUpperCase()} /><div><strong>{publishForm.title}</strong><span>{selectedSource?.wordCount ?? 0} 词 · {selectedSource?.title}</span><p>{publishForm.description || '暂无简介'}</p><small>{[publishForm.exam, publishForm.goal].filter(Boolean).join(' · ') || '未设置分类'}</small></div></div><p>确认后，社区会保存这本词本的当前副本。以后主动更新快照，也不会改动其他用户已加入的词本。</p>{publishError && <p className="publish-error" role="alert">{publishError}</p>}<div className="publish-actions"><button className="market-secondary" type="button" disabled={publishLoading} onClick={() => setPublishStep('details')}>返回修改</button><button className="market-primary" type="button" disabled={publishLoading} onClick={() => void submitPublish()}>{publishLoading ? '正在发布…' : publishTarget ? '更新社区快照' : '确认发布'}</button></div></>}</>}</section></div>}
    </section>
  )
}

function Collection({ title, icon, books, favorites, onToggleFavorite, onUpdate }: { title: string; icon: 'star' | 'cloud'; books: MarketplaceBook[]; favorites: Set<string>; onToggleFavorite: (id: string) => void; onUpdate?: (id: string) => void }) {
  return <section className="mini-collection"><header><h2><MarketplaceIcon name={icon} />{title}</h2><Link to="/wordbook">查看全部 ›</Link></header>{books.length ? <div>{books.slice(0, 2).map((book) => <article key={book.id}><BookCover tone={book.tone} label={book.shortLabel} /><span><strong>{book.title}</strong><small>{book.wordCount || '新建'}词 ｜ {book.author}</small>{onUpdate && <button className="collection-update" type="button" onClick={() => onUpdate(book.id)}>更新快照</button>}</span><button type="button" className={favorites.has(book.id) ? 'liked' : ''} aria-label="切换收藏" onClick={() => onToggleFavorite(book.id)}><MarketplaceIcon name="heart" /></button></article>)}</div> : <p className="collection-empty">还没有内容，去发现一本喜欢的词库吧。</p>}</section>
}
