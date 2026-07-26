import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { DictationPrompt } from '../components/word/DictationPrompt'
import { DictationSummary } from '../components/word/DictationSummary'
import { Flashcard } from '../components/word/Flashcard'
import { FlashcardControls } from '../components/word/FlashcardControls'
import { ImportWordbookDialog } from '../components/word/ImportWordbookDialog'
import {
  WordManagerDialog,
  type WordbookWordPatch,
} from '../components/wordbook/WordManagerDialog'
import {
  getWorkspaceApi,
  type MyWordbook,
  type StudyDashboard,
  type WordStatus,
  type WordbookProgress,
} from '../data/workspaceApi'
import {
  DEFAULT_STUDY_PREFERENCES,
  readStudyPreferences,
  writeStudyPreferences,
  type StudyDisplayPreferences,
  type StudyModeKey,
  type WordbookStudyPreferences,
} from '../data/studyPreferences'
import type { WordbookItem } from '../domain/types'
import { useDictationSession } from '../features/dictation/useDictationSession'
import { useFlashcardSession } from '../features/flashcards/useFlashcardSession'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { usePronounce } from '../hooks/usePronounce'

type StudyMode = StudyModeKey
type SettingsSection = 'plan' | StudyMode
type WorkspaceIconName = 'plus' | 'trash' | 'star' | 'edit' | 'book' | 'repeat' | 'headphones' | 'card' | 'settings' | 'chevron' | 'clock' | 'calendar' | 'fire' | 'dots'
type CoverTone = 'blue' | 'amber' | 'green' | 'lavender' | 'rose' | 'slate'
type WorkspaceBook = {
  id: string
  title: string
  description: string
  wordCount: number
  progress: WordbookProgress
  tone: CoverTone
  shortLabel: string
  createdAt: string
  updatedAt: string
  entries: WorkspaceEntry[]
}
type WorkspaceEntry = WordbookItem & { status?: WordStatus }

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

function formatActivityTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function activityResult(activity: StudyDashboard['recentActivity'][number]) {
  if (activity.kind === 'new') return activity.verdict === 'unknown'
    ? { result: '不熟', resultTone: 'pending' as const }
    : { result: '已学习', resultTone: 'active' as const }
  if (activity.kind === 'flashcard') return activity.verdict === 'know'
    ? { result: '已掌握', resultTone: 'done' as const }
    : { result: '待复习', resultTone: 'pending' as const }
  return activity.correct === false
    ? { result: '待复习', resultTone: 'pending' as const }
    : { result: '听写正确', resultTone: 'done' as const }
}

function toRecentStudyRows(activities: StudyDashboard['recentActivity'], entries: WordbookItem[]): RecentStudyRow[] {
  const entriesByWord = new Map(entries.map((entry) => [entry.word, entry]))
  return activities.slice(0, 5).map((activity) => {
    const meaning = entriesByWord.get(activity.word)?.meanings[0]
    return {
      id: activity.id,
      word: activity.word,
      pos: meaning?.pos || '—',
      definition: meaning?.definition || '—',
      ...activityResult(activity),
      time: formatActivityTime(activity.occurredAt),
    }
  })
}

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

function remoteToWorkspaceBook(book: MyWordbook, index: number): WorkspaceBook {
  const tones: CoverTone[] = ['blue', 'slate', 'rose', 'amber', 'green', 'lavender']
  return {
    id: book.id,
    title: book.title,
    description: book.description,
    wordCount: book.wordCount,
    progress: book.progress,
    tone: tones[index % tones.length],
    shortLabel: book.title.slice(0, 12),
    createdAt: book.createdAt,
    updatedAt: book.updatedAt,
    entries: [],
  }
}

export function WordbookPage() {
  useDocumentTitle('我的单词本')
  const [books, setBooks] = useState<WorkspaceBook[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [remoteTrash, setRemoteTrash] = useState<WorkspaceBook[]>([])
  const [showRecycle, setShowRecycle] = useState(false)
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const api = getWorkspaceApi()
  const [dashboard, setDashboard] = useState<StudyDashboard | null>(null)
  const [remoteEntries, setRemoteEntries] = useState<WorkspaceBook['entries'] | null>(null)
  const [dashboardLoading, setDashboardLoading] = useState(false)
  const [studyMode, setStudyMode] = useState<StudyMode | null>(null)
  const [settingsSection, setSettingsSection] = useState<SettingsSection | null>(null)
  const [showImporter, setShowImporter] = useState(false)
  const [showWordManager, setShowWordManager] = useState(false)
  const [wordSaving, setWordSaving] = useState(false)
  const [preferences, setPreferences] = useState<WordbookStudyPreferences>(
    () => structuredClone(DEFAULT_STUDY_PREFERENCES),
  )
  const dashboardRequest = useRef(0)
  const selectedBook = books.find((book) => book.id === selectedId) ?? books[0]

  const refreshMyWordbooks = useCallback(async (preferId?: string) => {
    if (!api) {
      setBooks([])
      setLoading(false)
      setNotice('未配置后端地址，无法读取单词本。')
      return
    }
    try {
      const remote = await api.listMyWordbooks()
      const mapped = remote.map(remoteToWorkspaceBook)
      setBooks(mapped)
      setSelectedId((current) => preferId ?? (mapped.some((book) => book.id === current) ? current : mapped[0]?.id ?? ''))
      setNotice('')
    } catch {
      setBooks([])
      setNotice('单词本加载失败，请确认后端服务可用后重试。')
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => { void refreshMyWordbooks() }, [refreshMyWordbooks])

  const refreshSelectedBook = useCallback(async () => {
    const requestId = ++dashboardRequest.current
    const wordbookId = selectedBook?.id
    if (!api || !wordbookId) {
      setDashboard(null)
      setRemoteEntries(null)
      setDashboardLoading(false)
      return
    }
    setDashboard(null)
    setRemoteEntries(null)
    setDashboardLoading(true)
    try {
      const [nextDashboard, words] = await Promise.all([
        api.getDashboard(wordbookId),
        api.listWords(wordbookId),
      ])
      if (dashboardRequest.current !== requestId) return
      setDashboard(nextDashboard)
      setRemoteEntries(words)
    } catch {
      if (dashboardRequest.current !== requestId) return
      setDashboard(null)
      setRemoteEntries(null)
      setNotice('词本详情加载失败，请稍后重试。')
    } finally {
      if (dashboardRequest.current === requestId) setDashboardLoading(false)
    }
  }, [api, selectedBook?.id])

  useEffect(() => { void refreshSelectedBook() }, [refreshSelectedBook])

  useEffect(() => {
    if (!selectedBook) return
    setPreferences(readStudyPreferences(selectedBook.id))
    setStudyMode(null)
    setSettingsSection(null)
  }, [selectedBook?.id])

  async function exitStudy() {
    setStudyMode(null)
    await refreshMyWordbooks(selectedBook.id)
    await refreshSelectedBook()
    setNotice('学习记录已从服务器刷新')
  }

  function savePreferences(next: WordbookStudyPreferences) {
    if (!selectedBook) return
    setPreferences(next)
    writeStudyPreferences(selectedBook.id, next)
  }

  function createBook() {
    setShowImporter(true)
  }

  async function finishImport(created: MyWordbook) {
    const existed = books.some((book) => book.id === created.id)
    await refreshMyWordbooks(created.id)
    setNotice(existed
      ? `已将当前草稿追加到「${created.title}」。`
      : `已创建「${created.title}」，其余批次已保存为导入草稿。`)
  }

  async function saveManagedWord(id: string, patch: WordbookWordPatch) {
    if (!api || !selectedBook) return
    const current = activeBook.entries.find((entry) => entry.id === id)
    setWordSaving(true)
    try {
      await api.updateWord(selectedBook.id, id, {
        ...patch,
        refresh: Boolean(current && current.word !== patch.word),
      })
      await refreshSelectedBook()
      await refreshMyWordbooks(selectedBook.id)
      setNotice(`已更新「${patch.word}」，未重新处理其他词条。`)
    } finally {
      setWordSaving(false)
    }
  }

  async function moveToRecycle(id: string) {
    const book = books.find((item) => item.id === id)
    if (!book) return
    if (!api) return
    try {
      await api.deleteMyWordbook(id)
      await refreshMyWordbooks()
      setNotice('词本已移入回收站。')
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
      setRemoteTrash((items) => items.filter((item) => item.id !== book.id))
      await refreshMyWordbooks(book.id)
      setNotice(`已恢复「${book.title}」。`)
    } catch {
      setNotice('恢复失败，请稍后重试。')
    }
  }

  async function purgeBook(book: WorkspaceBook) {
    if (!api) return
    if (!window.confirm(`彻底删除「${book.title}」？词本和它的学习记录将无法恢复。`)) return
    try {
      await api.purgeMyWordbook(book.id)
      setRemoteTrash((items) => items.filter((item) => item.id !== book.id))
      setNotice('词本已彻底删除。')
    } catch {
      setNotice('彻底删除失败，请稍后重试。')
    }
  }

  if (loading) {
    return <section className="workspace-empty-page"><EmptyState title="正在加载单词本" body="正在从后端读取你的词本与学习数据。" /></section>
  }

  if (!selectedBook) {
    return <>
      <section className="workspace-empty-page"><EmptyState title="还没有可用的词本" body={notice || '从广场导入一本词库，或创建新的个人词本。'} action={<Button onClick={createBook}>创建单词本</Button>} /></section>
      <ImportWordbookDialog
        open={showImporter}
        api={api}
        onClose={() => setShowImporter(false)}
        onCreated={(created) => { void finishImport(created) }}
      />
    </>
  }

  const activeBook = { ...selectedBook, entries: remoteEntries ?? [] }
  const progress = dashboard?.wordbook.progress ?? selectedBook.progress
  const wordCount = dashboard?.wordbook.wordCount ?? selectedBook.wordCount
  const learned = progress.mastered
  const studying = progress.learning
  const reviewDue = progress.review
  const completedNew = dashboard?.todayPlan.new.completed ?? 0
  const completedReview = dashboard?.todayPlan.review.completed ?? 0
  const completedDictation = dashboard?.todayPlan.dictation.completed ?? 0
  // Studied words are everything except the "new" (未学习) bucket — they feed 听写训练.
  const studiedCount = progress.mastered + progress.learning + progress.review
  const planCounts = {
    new: Math.min(preferences.plan.newWords, progress.unstudied + completedNew),
    review: Math.max(progress.review + progress.learning, completedReview),
    dictation: Math.min(preferences.plan.dictation, studiedCount),
  }
  // Contract E queue semantics: 新词学习 draws status 'new', 复习巩固 draws 'learning'|'review',
  // 听写训练 draws every studied word (status !== 'new'). Absent status is treated as 'new'.
  const entriesForMode = (nextMode: StudyMode) => {
    const statusOf = (entry: WorkspaceEntry) => entry.status ?? 'new'
    if (nextMode === 'new') {
      return activeBook.entries
        .filter((entry) => statusOf(entry) === 'new')
        .slice(0, preferences.plan.newWords)
    }
    if (nextMode === 'review') {
      return activeBook.entries.filter((entry) => statusOf(entry) === 'review' || statusOf(entry) === 'learning')
    }
    return activeBook.entries.filter((entry) => statusOf(entry) !== 'new').slice(0, preferences.plan.dictation)
  }
  // Every study-mode opener funnels through here so an enabled control can never
  // mount the session dialog with an empty deck (the session hooks seed their
  // queue once on mount and would lock in a fake "done" state).
  const entriesLoading = remoteEntries === null
  const openStudy = (nextMode: StudyMode) => {
    if (entriesForMode(nextMode).length === 0) {
      setNotice(entriesLoading ? '词条正在加载，请稍候再开始学习。' : '当前模式暂无可学的单词。')
      return
    }
    setStudyMode(nextMode)
  }

  return (
    <section className="workspace-page" aria-labelledby="workspace-title">
      <aside className="workspace-sidebar" aria-label="我的词库">
        <button type="button" className="workspace-create" onClick={createBook}><WorkspaceIcon name="plus" />创建单词本</button>
        <h2>我的词库</h2>
        <div className="workspace-book-list">{books.map((book) => <button key={book.id} type="button" className={book.id === selectedBook.id ? 'selected' : ''} onClick={() => setSelectedId(book.id)}><WorkspaceCover tone={book.tone} label={book.shortLabel} small /><span><strong>{book.title}</strong><small>{book.wordCount} 词</small></span></button>)}</div>
        <button type="button" className="workspace-recycle" onClick={() => void toggleRecycle()}><WorkspaceIcon name="trash" />回收站{remoteTrash.length ? ` (${remoteTrash.length})` : ''}</button>
        {showRecycle && <div className="recycle-panel"><p>回收站</p>{remoteTrash.length ? remoteTrash.map((book) => <div className="recycle-item" key={book.id}><strong title={book.title}>{book.title}</strong><span><button type="button" onClick={() => void restoreBook(book)}>恢复</button><button type="button" className="recycle-purge" onClick={() => void purgeBook(book)}>彻底删除</button></span></div>) : <small>暂无回收内容</small>}</div>}
      </aside>

      <main className="workspace-main">
        {notice && <p className="workspace-notice" role="status">{notice}</p>}
        <section className="workspace-overview">
          <WorkspaceCover tone={selectedBook.tone} label={selectedBook.shortLabel} />
          <div className="workspace-overview-main"><div className="workspace-title-row"><h1 id="workspace-title">{selectedBook.title}</h1></div><p>{wordCount} 个单词　|　创建于 {new Date(selectedBook.createdAt).toLocaleDateString('zh-CN')}　|　最后更新：{new Date(selectedBook.updatedAt).toLocaleString('zh-CN')}</p><div className="workspace-progress-label"><span>学习进度</span><strong>{progress.percent}%</strong></div><div className="workspace-progress" role="progressbar" aria-label="词本学习进度" aria-valuenow={progress.percent} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${progress.percent}%` }} /></div><div className="workspace-summary-stats"><span>已掌握<strong className="green">{learned}</strong></span><span>学习中<strong className="blue">{studying}</strong></span><span>待复习<strong className="orange">{reviewDue}</strong></span><span>未学习<strong>{progress.unstudied}</strong></span></div></div><div className="overview-actions"><button type="button" className="overview-plan-settings" onClick={() => setSettingsSection('plan')}><WorkspaceIcon name="settings" />学习计划</button><button type="button" disabled={!wordCount || dashboardLoading} onClick={() => setShowWordManager(true)}><WorkspaceIcon name="edit" />管理词条</button><button type="button" onClick={() => void moveToRecycle(selectedBook.id)}>移入回收站</button></div>
        </section>

        <section className="workspace-plan"><header><h2>今日学习计划</h2><button type="button" onClick={() => setSettingsSection('plan')}><WorkspaceIcon name="settings" />调整计划</button></header><div className="plan-cards"><PlanCard icon="book" tone="blue" title="新词学习" count={planCounts.new} available={entriesForMode('new').length} loading={entriesLoading} completed={completedNew} detail="学习新词，建立印象" button="开始学习" onClick={() => openStudy('new')} onSettings={() => setSettingsSection('new')} /><PlanCard icon="repeat" tone="amber" title="复习巩固" count={planCounts.review} available={entriesForMode('review').length} loading={entriesLoading} completed={completedReview} detail="强化记忆，巩固掌握" button="开始复习" onClick={() => openStudy('review')} onSettings={() => setSettingsSection('review')} /><PlanCard icon="headphones" tone="green" title="听写训练" count={planCounts.dictation} available={entriesForMode('dictation').length} loading={entriesLoading} completed={completedDictation} detail="听音拼写，检测掌握" button="开始听写" onClick={() => openStudy('dictation')} onSettings={() => setSettingsSection('dictation')} /></div></section>

        <div className="workspace-lower">
          <RecentStudy
            activities={dashboard?.recentActivity}
            entries={activeBook.entries}
            loading={dashboardLoading}
            onContinue={() => openStudy('review')}
          />
          <StudyCalendar calendar={dashboard?.calendar} loading={dashboardLoading} />
        </div>
      </main>

      <aside className="workspace-rail" aria-label="快捷功能和学习数据">
        <section className="quick-actions"><h2>快捷功能</h2><QuickAction icon="book" title="单词学习" detail="认识新词，理解含义" onClick={() => openStudy('new')} /><QuickAction icon="repeat" title="复习巩固" detail="复习旧词，加深记忆" onClick={() => openStudy('review')} /><QuickAction icon="headphones" title="听写训练" detail="听音拼写，强化记忆" onClick={() => openStudy('dictation')} /><QuickAction icon="card" title="单词卡片" detail="浏览卡片，快速记忆" onClick={() => openStudy('new')} /></section>
        <WeeklyStudyData week={dashboard?.week} loading={dashboardLoading} />
        <StudyStreak days={dashboard?.streakDays} loading={dashboardLoading} />
      </aside>
      {settingsSection && <StudySettingsDialog
        section={settingsSection}
        preferences={preferences}
        wordCount={wordCount}
        onChange={savePreferences}
        onClose={() => setSettingsSection(null)}
      />}
      {studyMode && <StudySessionDialog
        book={{ ...activeBook, entries: entriesForMode(studyMode) }}
        mode={studyMode}
        preferences={preferences.modes[studyMode]}
        onClose={() => void exitStudy()}
      />}
      <ImportWordbookDialog
        open={showImporter}
        api={api}
        onClose={() => setShowImporter(false)}
        onCreated={(created) => { void finishImport(created) }}
      />
      {showWordManager && <WordManagerDialog
        title={selectedBook.title}
        entries={activeBook.entries}
        saving={wordSaving}
        onClose={() => setShowWordManager(false)}
        onSave={saveManagedWord}
      />}
    </section>
  )
}

function PlanCard({ icon, tone, title, count, available, loading, completed, detail, button, onClick, onSettings }: { icon: 'book' | 'repeat' | 'headphones'; tone: 'blue' | 'amber' | 'green'; title: string; count: number; available: number; loading: boolean; completed: number; detail: string; button: string; onClick: () => void; onSettings: () => void }) {
  const progress = count ? Math.min(100, completed / count * 100) : 0
  // The start button follows the actual studyable deck (`available`), not the
  // day-plan tally — the tally keeps counting words finished earlier today.
  return <article className={`plan-card ${tone}`}><WorkspaceIcon name={icon} /><h3>{title}</h3><button type="button" className="plan-card-settings" aria-label={`设置${title}`} title={`设置${title}`} onClick={onSettings}><WorkspaceIcon name="settings" /></button><p>{detail}</p><strong>{count}<small>词</small></strong><div><i style={{ width: `${progress}%` }} /><span>{Math.min(completed, count)}/{count}</span></div><button type="button" disabled={available === 0} onClick={onClick}>{loading ? '加载中…' : available ? button : '暂无可学单词'}</button></article>
}

function QuickAction({ icon, title, detail, onClick }: { icon: 'book' | 'repeat' | 'headphones' | 'card'; title: string; detail: string; onClick: () => void }) {
  return <button type="button" onClick={onClick}><span><WorkspaceIcon name={icon} /></span><div><strong>{title}</strong><small>{detail}</small></div><WorkspaceIcon name="chevron" /></button>
}

function RecentStudy({ activities, entries, loading, onContinue }: { activities: StudyDashboard['recentActivity'] | undefined; entries: WordbookItem[]; loading: boolean; onContinue: () => void }) {
  const rows = activities ? toRecentStudyRows(activities, entries) : []
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
  const total = counts ? counts.new + counts.review + counts.dictation : 0
  const newStop = total ? counts!.new / total * 100 : 0
  const reviewStop = total ? newStop + counts!.review / total * 100 : 0
  const donutStyle = total ? {
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
  return <section className="study-streak"><h2><WorkspaceIcon name="fire" />连续学习</h2>{days === undefined ? <p className="workspace-data-state" role={loading ? 'status' : undefined}>{loading ? '正在载入连续学习数据。' : '连续学习数据暂不可用。'}</p> : <><strong>{days} <small>天</small></strong><p>继续加油，养成好习惯！</p><div>{['一','二','三','四','五','六','日'].map((day, index) => <span key={day}><small>{day}</small><i className={index < Math.min(7, days) ? 'complete' : ''}>{index < Math.min(7, days) ? '✓' : ''}</i></span>)}</div></>}</section>
}

function StudySettingsDialog({ section, preferences, wordCount, onChange, onClose }: { section: SettingsSection; preferences: WordbookStudyPreferences; wordCount: number; onChange: (next: WordbookStudyPreferences) => void; onClose: () => void }) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [onClose])

  const titles: Record<SettingsSection, string> = {
    plan: '自定义学习计划',
    new: '新词学习设置',
    review: '复习巩固设置',
    dictation: '听写训练设置',
  }
  const updatePlan = (key: 'newWords' | 'dictation', value: number) => onChange({
    ...preferences,
    plan: { ...preferences.plan, [key]: Math.max(0, Math.min(999, Math.round(value || 0))) },
  })
  const updateMode = (key: keyof StudyDisplayPreferences | 'underlineMistakes', value: boolean | 'zh' | 'en') => {
    if (section === 'plan') return
    onChange({
      ...preferences,
      modes: {
        ...preferences.modes,
        [section]: { ...preferences.modes[section], [key]: value },
      },
    })
  }
  const modePreferences = section === 'plan' ? null : preferences.modes[section]

  return <div className="workspace-modal-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="study-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="study-settings-title" onMouseDown={(event) => event.stopPropagation()}>
      <header><div><p className="marginal">{section === 'plan' ? '当前词本' : '学习体验'}</p><h2 id="study-settings-title">{titles[section]}</h2></div><button type="button" className="workspace-modal-close" aria-label="关闭设置" onClick={onClose}>×</button></header>
      {section === 'plan' ? <div className="study-plan-settings">
        <label><span><strong>每日新词</strong><small>计划学习的未学习单词数</small></span><input type="number" min="0" max="999" inputMode="numeric" value={preferences.plan.newWords} onChange={(event) => updatePlan('newWords', Number(event.target.value))} /><em>词</em></label>
        <label><span><strong>每日听写</strong><small>每轮听写抽取的单词数</small></span><input type="number" min="0" max="999" inputMode="numeric" value={preferences.plan.dictation} onChange={(event) => updatePlan('dictation', Number(event.target.value))} /><em>词</em></label>
        <p className="study-settings-note">当前词本共 {wordCount} 词。页面会自动按未学习、待复习和可用词数缩减计划，不会显示超过词本容量的任务。</p>
      </div> : modePreferences && <div className="study-mode-settings">
        <fieldset><legend>默认释义</legend><div className="meaning-preference">
          <button type="button" className={modePreferences.meaningPreference === 'zh' ? 'selected' : ''} onClick={() => updateMode('meaningPreference', 'zh')}>中文释义优先</button>
          <button type="button" className={modePreferences.meaningPreference === 'en' ? 'selected' : ''} onClick={() => updateMode('meaningPreference', 'en')}>英英释义优先</button>
        </div><small>所选语言缺失时会自动回退，保证始终有释义可看。</small></fieldset>
        <SettingToggle label="显示例句" detail="在答案或卡片背面展示词典例句" checked={modePreferences.showExamples} onChange={(value) => updateMode('showExamples', value)} />
        <SettingToggle label="显示音标" detail="在词头或答案中展示音标" checked={modePreferences.showPhonetic} onChange={(value) => updateMode('showPhonetic', value)} />
        {section === 'dictation' && <SettingToggle label="标出错字母" detail="用红色下划线标记输入中位置错误的字母" checked={preferences.modes.dictation.underlineMistakes} onChange={(value) => updateMode('underlineMistakes', value)} />}
      </div>}
      <footer><Button onClick={onClose}>完成</Button></footer>
    </section>
  </div>
}

function SettingToggle({ label, detail, checked, onChange }: { label: string; detail: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="study-setting-toggle"><span><strong>{label}</strong><small>{detail}</small></span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><i aria-hidden="true" /></label>
}

function StudySessionDialog({ book, mode, preferences, onClose }: { book: WorkspaceBook; mode: StudyMode; preferences: StudyDisplayPreferences & { underlineMistakes?: boolean }; onClose: () => void }) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [onClose])

  return <div className="workspace-modal-backdrop study-session-backdrop" role="presentation">
    <section className="workspace-study-modal" role="dialog" aria-modal="true" aria-label={`${mode === 'new' ? '新词学习' : mode === 'review' ? '复习巩固' : '听写训练'}悬浮窗口`}>
      <button type="button" className="workspace-modal-close session-close" aria-label="关闭学习窗口" onClick={onClose}>×</button>
      <WordbookStudyMode book={book} mode={mode} preferences={preferences} reportEnabled onExit={onClose} />
    </section>
  </div>
}

function WordbookStudyMode({ book, mode, preferences, reportEnabled, onExit }: { book: WorkspaceBook; mode: StudyMode; preferences: StudyDisplayPreferences & { underlineMistakes?: boolean }; reportEnabled: boolean; onExit: () => void }) {
  const api = getWorkspaceApi()
  const reportVerdict = useCallback((word: string, verdict: 'know' | 'unknown') => {
    if (!reportEnabled || !api) return
    const event = mode === 'new'
      ? { kind: 'new' as const, word, wordbookId: book.id, verdict }
      : { kind: 'flashcard' as const, word, verdict, wordbookId: book.id }
    void api.recordStudyEvent(event).catch(() => undefined)
  }, [api, book.id, mode, reportEnabled])
  const reportGrade = useCallback((word: string, correct: boolean) => {
    if (!reportEnabled || !api) return
    void api.recordStudyEvent({ kind: 'dictation', word, correct, wordbookId: book.id }).catch(() => undefined)
  }, [api, book.id, reportEnabled])
  const flashcards = useFlashcardSession(book.entries, reportVerdict)
  const dictation = useDictationSession(book.entries, reportGrade)
  const { pronounce } = usePronounce(dictation.current?.word ?? '', dictation.current?.audioUrl, .78)

  const modeTitle = mode === 'new' ? '新词学习' : mode === 'review' ? '复习巩固' : '听写训练'
  const emptyBody = mode === 'review'
    ? '完成新词学习或把不熟悉的单词标为待复习后，它们会出现在这里。'
    : mode === 'dictation'
      ? '先学习一些单词，学过的单词才会进入听写训练。'
      : '先向词本添加单词，或在学习计划中提高本模式的单词数。'
  if (book.entries.length === 0) return <section className="workspace-study"><StudyHeader book={book} mode={mode} onExit={onExit} /><EmptyState title={`暂无可用于${modeTitle}的单词`} body={emptyBody} action={<Button onClick={onExit}>关闭窗口</Button>} /></section>

  if (mode !== 'dictation') {
    return <section className="workspace-study"><StudyHeader book={book} mode={mode} onExit={onExit} />{flashcards.done ? <div className="workspace-session-summary"><p>本轮{modeTitle}完成</p><h2>掌握 <strong>{flashcards.knownCount}</strong> 词，共 {flashcards.totalCount} 词</h2><p>{flashcards.unknownCount ? `${flashcards.unknownCount} 个词已标记为不熟，可稍后继续复习。` : '这一轮表现很好，继续保持。'}</p><div><Button onClick={flashcards.restart}>再来一轮</Button><Button variant="secondary" onClick={onExit}>关闭窗口</Button></div></div> : <><div className="workspace-study-progress"><span>{modeTitle}</span><strong>{flashcards.reviewedCount} / {flashcards.totalCount}</strong></div>{flashcards.current && <Flashcard item={flashcards.current} flipped={flashcards.flipped} onFlip={flashcards.flip} preferences={preferences} />}<FlashcardControls flipped={flashcards.flipped} onFlip={flashcards.flip} onKnow={flashcards.markKnown} onUnknown={flashcards.markUnknown} disableVerdicts={!flashcards.flipped} /></>}</section>
  }

  const lastAnswer = dictation.answers[dictation.answers.length - 1]
  return <section className="workspace-study"><StudyHeader book={book} mode={mode} onExit={onExit} />{dictation.phase === 'summary' ? <div className="workspace-session-summary"><DictationSummary total={dictation.deck.length} correct={dictation.correctCount} wrong={dictation.wrongDeck} onRetryAll={dictation.retryAll} onRetryWrong={dictation.retryWrong} /><Button variant="secondary" onClick={onExit}>关闭窗口</Button></div> : <><div className="workspace-study-progress"><span>听写训练</span><strong>{dictation.index + 1} / {dictation.deck.length}</strong></div>{dictation.current && <DictationPrompt item={dictation.current} answer={dictation.answer} onAnswerChange={dictation.setAnswer} onSubmit={dictation.submit} onNext={dictation.next} onPlay={pronounce} phase={dictation.phase} grade={dictation.phase === 'feedback' ? lastAnswer?.grade ?? null : null} error={dictation.inputError} isLast={dictation.isLast} preferences={preferences} />}</>}</section>
}

function StudyHeader({ book, mode, onExit }: { book: WorkspaceBook; mode: StudyMode; onExit: () => void }) {
  return <header className="workspace-study-header"><button type="button" onClick={onExit}>关闭</button><span><WorkspaceCover tone={book.tone} label={book.shortLabel} small /><strong>{book.title}</strong></span><h1>{mode === 'new' ? '新词学习' : mode === 'review' ? '复习巩固' : '听写训练'}</h1></header>
}
