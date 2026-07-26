import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { DictationPrompt } from '../components/word/DictationPrompt'
import { DictationSummary } from '../components/word/DictationSummary'
import { Flashcard } from '../components/word/Flashcard'
import { FlashcardControls } from '../components/word/FlashcardControls'
import {
  getWorkspaceApi,
  type MyWordbook,
  type StudyDashboard,
  type WordbookProgress,
} from '../data/workspaceApi'
import type { WordbookItem } from '../domain/types'
import { useDictationSession } from '../features/dictation/useDictationSession'
import { useFlashcardSession } from '../features/flashcards/useFlashcardSession'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { usePronounce } from '../hooks/usePronounce'

type StudyMode = 'flashcards' | 'dictation'
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
  entries: WordbookItem[]
}

function WorkspaceIcon({ name }: { name: WorkspaceIconName }) {
  const paths: Record<WorkspaceIconName, ReactNode> = {
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
  return <svg className="workspace-icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>
}

function WorkspaceCover({ tone, label, small = false }: { tone: CoverTone; label: string; small?: boolean }) {
  return <div className={`workspace-cover cover-${tone} ${small ? 'small' : ''}`} aria-hidden="true"><span>{label}</span><i /></div>
}

function modeFromSearch(value: string | null): StudyMode | null {
  return value === 'flashcards' || value === 'dictation' ? value : null
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
  const [params, setParams] = useSearchParams()
  const [books, setBooks] = useState<WorkspaceBook[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [remoteTrash, setRemoteTrash] = useState<WorkspaceBook[]>([])
  const [showRecycle, setShowRecycle] = useState(false)
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const api = getWorkspaceApi()
  const [dashboard, setDashboard] = useState<StudyDashboard | null>(null)
  const [remoteEntries, setRemoteEntries] = useState<WorkspaceBook['entries'] | null>(null)
  const mode = modeFromSearch(params.get('mode'))
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
    if (!api || !selectedBook) {
      setDashboard(null)
      setRemoteEntries(null)
      return
    }
    try {
      const [nextDashboard, words] = await Promise.all([
        api.getDashboard(selectedBook.id),
        api.listWords(selectedBook.id),
      ])
      setDashboard(nextDashboard)
      setRemoteEntries(words)
    } catch {
      setDashboard(null)
      setRemoteEntries(null)
      setNotice('词本详情加载失败，请稍后重试。')
    }
  }, [api, selectedBook])

  useEffect(() => { void refreshSelectedBook() }, [refreshSelectedBook])

  const openMode = useCallback((nextMode: StudyMode) => {
    setParams({ mode: nextMode })
  }, [setParams])

  async function exitStudy() {
    setParams({})
    await refreshMyWordbooks(selectedBook.id)
    await refreshSelectedBook()
    setNotice('学习记录已从服务器刷新')
  }

  async function createBook() {
    const title = window.prompt('新单词本名称')?.trim()
    if (!title) return
    if (!api) {
      setNotice('未配置后端，无法创建单词本。')
      return
    }
    try {
      const created = await api.createMyWordbook({ title })
      await refreshMyWordbooks(created.id)
      setNotice(`已创建「${title}」并同步。`)
    } catch {
      setNotice('创建失败，请确认后端服务可用后重试。')
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

  if (loading) {
    return <section className="workspace-empty-page"><EmptyState title="正在加载单词本" body="正在从后端读取你的词本与学习数据。" /></section>
  }

  if (!selectedBook) {
    return <section className="workspace-empty-page"><EmptyState title="还没有可用的词本" body={notice || '从广场导入一本词库，或创建新的个人词本。'} action={<Button onClick={createBook}>创建单词本</Button>} /></section>
  }

  const activeBook = { ...selectedBook, entries: remoteEntries ?? [] }
  const progress = dashboard?.wordbook.progress ?? selectedBook.progress
  const wordCount = dashboard?.wordbook.wordCount ?? selectedBook.wordCount

  if (mode) {
    return <WordbookStudyMode key={`${activeBook.id}-${mode}`} book={activeBook} mode={mode} reportEnabled onExit={() => void exitStudy()} />
  }

  const learned = progress.mastered
  const studying = progress.learning
  const reviewDue = progress.review

  return (
    <section className="workspace-page" aria-labelledby="workspace-title">
      <aside className="workspace-sidebar" aria-label="我的词库">
        <button type="button" className="workspace-create" onClick={createBook}><WorkspaceIcon name="plus" />创建单词本</button>
        <h2>我的词库</h2>
        <div className="workspace-book-list">{books.map((book) => <button key={book.id} type="button" className={book.id === selectedBook.id ? 'selected' : ''} onClick={() => setSelectedId(book.id)}><WorkspaceCover tone={book.tone} label={book.shortLabel} small /><span><strong>{book.title}</strong><small>{book.wordCount} 词</small></span></button>)}</div>
        <button type="button" className="workspace-recycle" onClick={() => void toggleRecycle()}><WorkspaceIcon name="trash" />回收站{remoteTrash.length ? ` (${remoteTrash.length})` : ''}</button>
        {showRecycle && <div className="recycle-panel"><p>回收站</p>{remoteTrash.length ? remoteTrash.map((book) => <button type="button" key={book.id} onClick={() => void restoreBook(book)}>恢复 {book.title}</button>) : <small>暂无回收内容</small>}</div>}
      </aside>

      <main className="workspace-main">
        {notice && <p className="workspace-notice" role="status">{notice}</p>}
        <section className="workspace-overview">
          <WorkspaceCover tone={selectedBook.tone} label={selectedBook.shortLabel} />
          <div className="workspace-overview-main"><div className="workspace-title-row"><h1 id="workspace-title">{selectedBook.title}</h1></div><p>{wordCount} 个单词　|　创建于 {new Date(selectedBook.createdAt).toLocaleDateString('zh-CN')}　|　最后更新：{new Date(selectedBook.updatedAt).toLocaleString('zh-CN')}</p><div className="workspace-progress-label"><span>学习进度</span><strong>{progress.percent}%</strong></div><div className="workspace-progress" role="progressbar" aria-label="词本学习进度" aria-valuenow={progress.percent} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${progress.percent}%` }} /></div><div className="workspace-summary-stats"><span>已掌握<strong className="green">{learned}</strong></span><span>学习中<strong className="blue">{studying}</strong></span><span>待复习<strong className="orange">{reviewDue}</strong></span><span>未学习<strong>{progress.unstudied}</strong></span></div></div><div className="overview-actions"><button type="button" onClick={() => void moveToRecycle(selectedBook.id)}>移入回收站</button></div>
        </section>

        <section className="workspace-plan"><header><h2>今日学习计划</h2></header><div className="plan-cards"><PlanCard icon="book" tone="blue" title="新词学习" count={dashboard?.todayPlan.new.target ?? 0} completed={dashboard?.todayPlan.new.completed ?? 0} detail="学习新词，建立印象" button="开始学习" onClick={() => openMode('flashcards')} /><PlanCard icon="repeat" tone="amber" title="复习巩固" count={dashboard?.todayPlan.review.target ?? 0} completed={dashboard?.todayPlan.review.completed ?? 0} detail="强化记忆，巩固掌握" button="开始复习" onClick={() => openMode('flashcards')} /><PlanCard icon="headphones" tone="green" title="听写训练" count={dashboard?.todayPlan.dictation.target ?? 0} completed={dashboard?.todayPlan.dictation.completed ?? 0} detail="听音拼写，检测掌握" button="开始听写" onClick={() => openMode('dictation')} /></div></section>

        <div className="workspace-lower"><section className="recent-study"><header><h2>最近学习</h2><button type="button" onClick={() => openMode('flashcards')}>继续学习 ›</button></header><div>{dashboard?.recentActivity.length ? dashboard.recentActivity.slice(0, 5).map((activity) => ({ id: activity.id, word: activity.word, definition: activeBook.entries.find((entry) => entry.word === activity.word)?.meanings[0]?.definition ?? '', pos: activeBook.entries.find((entry) => entry.word === activity.word)?.meanings[0]?.pos ?? '', status: activity.kind === 'flashcard' && activity.verdict === 'know' ? '已掌握' : activity.kind === 'dictation' && activity.correct === false ? '待复习' : '学习中', time: new Date(activity.occurredAt).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' }) })).map((entry) => <article key={entry.id}><strong>{entry.word}</strong><small>{entry.pos}</small><p>{entry.definition}</p><span className={entry.status === '待复习' ? 'pending' : entry.status === '学习中' ? 'active' : 'done'}>{entry.status}</span><time>{entry.time}</time></article>) : <p>还没有学习记录。</p>}</div></section><StudyCalendar calendar={dashboard?.calendar ?? []} /></div>
      </main>

      <aside className="workspace-rail" aria-label="快捷功能和学习数据"><section className="quick-actions"><h2>快捷功能</h2><QuickAction icon="book" title="单词学习" detail="认识新词，理解含义" onClick={() => openMode('flashcards')} /><QuickAction icon="repeat" title="复习巩固" detail="复习旧词，加深记忆" onClick={() => openMode('flashcards')} /><QuickAction icon="headphones" title="听写训练" detail="听音拼写，强化记忆" onClick={() => openMode('dictation')} /><QuickAction icon="card" title="单词卡片" detail="浏览卡片，快速记忆" onClick={() => openMode('flashcards')} /></section><section className="workspace-data"><header><h2>学习数据</h2><span>本周</span></header><div className="data-donut"><span>本周学习<strong>{dashboard?.week.total ?? 0} 词</strong></span></div><ul><li><i className="blue" />新词学习 <strong>{dashboard?.week.newCount ?? 0}</strong></li><li><i className="orange" />复习巩固 <strong>{dashboard?.week.reviewCount ?? 0}</strong></li><li><i className="green" />听写训练 <strong>{dashboard?.week.dictationCount ?? 0}</strong></li></ul></section><section className="study-streak"><h2><WorkspaceIcon name="fire" />连续学习</h2><strong>{dashboard?.streakDays ?? 0} <small>天</small></strong><p>继续加油，养成好习惯！</p><div>{['一','二','三','四','五','六','日'].map((day, index) => <span key={day}><small>{day}</small><i className={index < Math.min(7, dashboard?.streakDays ?? 0) ? 'complete' : ''}>{index < Math.min(7, dashboard?.streakDays ?? 0) ? '✓' : ''}</i></span>)}</div></section></aside>
    </section>
  )
}

function PlanCard({ icon, tone, title, count, completed, detail, button, onClick }: { icon: 'book' | 'repeat' | 'headphones'; tone: 'blue' | 'amber' | 'green'; title: string; count: number; completed: number; detail: string; button: string; onClick: () => void }) {
  const progress = count ? Math.min(100, completed / count * 100) : 0
  return <article className={`plan-card ${tone}`}><WorkspaceIcon name={icon} /><h3>{title}</h3><p>{detail}</p><strong>{count}<small>词</small></strong><div><i style={{ width: `${progress}%` }} /><span>{completed}/{count}</span></div><button type="button" onClick={onClick}>{button}</button></article>
}

function QuickAction({ icon, title, detail, onClick }: { icon: 'book' | 'repeat' | 'headphones' | 'card'; title: string; detail: string; onClick: () => void }) {
  return <button type="button" onClick={onClick}><span><WorkspaceIcon name={icon} /></span><div><strong>{title}</strong><small>{detail}</small></div><WorkspaceIcon name="chevron" /></button>
}

function StudyCalendar({ calendar }: { calendar: StudyDashboard['calendar'] }) {
  const days = calendar.slice(-7).map((entry, index) => ({ label: index === calendar.slice(-7).length - 1 ? '今天' : entry.date.slice(5).replace('-', '/'), count: entry.count, active: entry.active, today: index === calendar.slice(-7).length - 1 }))
  return <section className="study-calendar"><header><h2>学习日历</h2></header>{days.length ? <div className="calendar-days">{days.map((day) => <article key={day.label} className={day.today ? 'today' : ''}><strong>{day.label}</strong><small>{day.count}词</small><span>{day.active ? '✓' : '○'}</span></article>)}</div> : <p>暂无学习日历数据。</p>}</section>
}

function WordbookStudyMode({ book, mode, reportEnabled, onExit }: { book: WorkspaceBook; mode: StudyMode; reportEnabled: boolean; onExit: () => void }) {
  const api = getWorkspaceApi()
  const reportVerdict = useCallback((word: string, verdict: 'know' | 'unknown') => {
    if (!reportEnabled || !api) return
    void api.recordStudyEvent({ kind: 'flashcard', word, verdict, wordbookId: book.id }).catch(() => undefined)
  }, [api, book.id, reportEnabled])
  const reportGrade = useCallback((word: string, correct: boolean) => {
    if (!reportEnabled || !api) return
    void api.recordStudyEvent({ kind: 'dictation', word, correct, wordbookId: book.id }).catch(() => undefined)
  }, [api, book.id, reportEnabled])
  const flashcards = useFlashcardSession(book.entries, reportVerdict)
  const dictation = useDictationSession(book.entries, reportGrade)
  const { pronounce } = usePronounce(dictation.current?.word ?? '', dictation.current?.audioUrl, .78)

  if (book.entries.length === 0) return <section className="workspace-study"><StudyHeader book={book} mode={mode} onExit={onExit} /><EmptyState title="这个词本还没有单词" body="从单词广场导入词库，或在查词页把单词收入词本后再开始学习。" action={<Button onClick={onExit}>返回工作台</Button>} /></section>

  if (mode === 'flashcards') {
    return <section className="workspace-study"><StudyHeader book={book} mode={mode} onExit={onExit} />{flashcards.done ? <div className="workspace-session-summary"><p>本轮学习完成</p><h2>掌握 <strong>{flashcards.knownCount}</strong> 词，共 {flashcards.totalCount} 词</h2><p>{flashcards.unknownCount ? `${flashcards.unknownCount} 个词已标记为不熟，可再复习一次。` : '这一轮表现很好，继续保持。'}</p><div><Button onClick={flashcards.restart}>再来一轮</Button><Button variant="secondary" onClick={onExit}>返回工作台</Button></div></div> : <><div className="workspace-study-progress"><span>单词卡学习</span><strong>{flashcards.reviewedCount} / {flashcards.totalCount}</strong></div>{flashcards.current && <Flashcard item={flashcards.current} flipped={flashcards.flipped} onFlip={flashcards.flip} />}<FlashcardControls flipped={flashcards.flipped} onFlip={flashcards.flip} onKnow={flashcards.markKnown} onUnknown={flashcards.markUnknown} disableVerdicts={!flashcards.flipped} /></>}</section>
  }

  const lastAnswer = dictation.answers[dictation.answers.length - 1]
  return <section className="workspace-study"><StudyHeader book={book} mode={mode} onExit={onExit} />{dictation.phase === 'summary' ? <div className="workspace-session-summary"><DictationSummary total={dictation.deck.length} correct={dictation.correctCount} wrong={dictation.wrongDeck} onRetryAll={dictation.retryAll} onRetryWrong={dictation.retryWrong} /><Button variant="secondary" onClick={onExit}>返回工作台</Button></div> : <><div className="workspace-study-progress"><span>听写训练</span><strong>{dictation.index + 1} / {dictation.deck.length}</strong></div>{dictation.current && <DictationPrompt item={dictation.current} answer={dictation.answer} onAnswerChange={dictation.setAnswer} onSubmit={dictation.submit} onNext={dictation.next} onPlay={pronounce} phase={dictation.phase} grade={dictation.phase === 'feedback' ? lastAnswer?.grade ?? null : null} error={dictation.inputError} isLast={dictation.isLast} />}</>}</section>
}

function StudyHeader({ book, mode, onExit }: { book: WorkspaceBook; mode: StudyMode; onExit: () => void }) {
  return <header className="workspace-study-header"><button type="button" onClick={onExit}>‹ 返回工作台</button><span><WorkspaceCover tone={book.tone} label={book.shortLabel} small /><strong>{book.title}</strong></span><h1>{mode === 'flashcards' ? '单词卡学习' : '听写训练'}</h1></header>
}
