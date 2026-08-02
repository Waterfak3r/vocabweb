import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { ContributionSubmitDialog } from '../components/marketplace/ContributionSubmitDialog'
import {
  getWorkspaceApi,
  type CatalogContribution,
  type CatalogRevision,
  type CatalogWordbook,
  type CatalogWordsPage,
} from '../data/workspaceApi'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useAuth } from '../hooks/useAuth'

type DetailTab = 'words' | 'contributions' | 'revisions'

export const CATALOG_WORDS_PAGE_SIZE = 50
const WORD_SEARCH_DEBOUNCE_MS = 250

const REVISION_KIND: Record<CatalogRevision['kind'], string> = {
  initial: '首次发布',
  update: '发布者更新',
  merge: '合并建议',
  revert: '回滚',
}

const CONTRIBUTION_STATUS: Record<CatalogContribution['status'], string> = {
  open: '待审核',
  merged: '已合并',
  closed: '已关闭',
}

function shortRevision(id: string) {
  return id.replace(/^revision-/, '').slice(0, 8)
}

function ChangeStats({ additions, deletions, updates }: { additions: number; deletions: number; updates: number }) {
  return (
    <span className="collab-list-stats" aria-label={`新增 ${additions}，删除 ${deletions}，修改 ${updates}`}>
      <b>+{additions}</b>
      <i>-{deletions}</i>
      <span>{updates} 改</span>
    </span>
  )
}

export function MarketplaceDetailPage() {
  const { id = '' } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedTab = searchParams.get('tab')
  const marketplaceFrom = (searchParams.get('from') ?? '').slice(0, 2_000)
  const activeTab: DetailTab = requestedTab === 'contributions' || requestedTab === 'revisions'
    ? requestedTab
    : 'words'
  const api = getWorkspaceApi()
  const { user, loading: authLoading } = useAuth()
  const [book, setBook] = useState<CatalogWordbook | null>(null)
  const [contributions, setContributions] = useState<CatalogContribution[]>([])
  const [revisions, setRevisions] = useState<CatalogRevision[]>([])
  const [contributionsNextCursor, setContributionsNextCursor] = useState<string>()
  const [revisionsNextCursor, setRevisionsNextCursor] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [tabLoading, setTabLoading] = useState(false)
  const [tabLoadingMore, setTabLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [tabError, setTabError] = useState('')
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [words, setWords] = useState<CatalogWordsPage['items']>([])
  const [wordPage, setWordPage] = useState(1)
  const [wordTotal, setWordTotal] = useState(0)
  const [wordTotalPages, setWordTotalPages] = useState(1)
  const [wordsLoading, setWordsLoading] = useState(true)
  const [wordsError, setWordsError] = useState('')
  const [wordsReload, setWordsReload] = useState(0)
  const [message, setMessage] = useState('')
  const [preparingContribution, setPreparingContribution] = useState(false)
  const [contributionBookId, setContributionBookId] = useState<string | null>(null)
  const contributionTriggerRef = useRef<HTMLElement | null>(null)
  const wordListRef = useRef<HTMLDivElement | null>(null)
  const wordRequestSeq = useRef(0)
  useDocumentTitle(book?.title ? `${book.title} · 单词广场` : '词本概况')

  useEffect(() => {
    let active = true
    if (!api || !id) {
      setError('无法读取该词本。')
      setLoading(false)
      return () => { active = false }
    }
    setLoading(true)
    void api.getCatalogSummary(id).then((summary) => {
      if (!active) return
      setBook(summary)
      setError('')
    }).catch(() => {
      if (!active) return
      setBook(null)
      setError('该词本不存在、不可见或暂时无法加载。')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [api, id])

  useEffect(() => {
    setQuery('')
    setDebouncedQuery('')
    setWords([])
    setWordPage(1)
    setWordTotal(0)
    setWordTotalPages(1)
    setWordsError('')
  }, [id])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setWordPage(1)
      setDebouncedQuery(query.trim())
    }, WORD_SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timeout)
  }, [query])

  useEffect(() => {
    if (!api || !id || activeTab !== 'words') return
    let active = true
    const seq = ++wordRequestSeq.current
    setWordsLoading(true)
    setWordsError('')
    void api.listCatalogWords(id, {
      page: wordPage,
      pageSize: CATALOG_WORDS_PAGE_SIZE,
      ...(debouncedQuery ? { q: debouncedQuery } : {}),
    }).then((result) => {
      if (!active || seq !== wordRequestSeq.current) return
      setWords(result.items)
      setWordTotal(result.total)
      setWordTotalPages(result.totalPages)
      if (result.page !== wordPage) setWordPage(result.page)
      if (wordListRef.current) wordListRef.current.scrollTop = 0
    }).catch(() => {
      if (!active || seq !== wordRequestSeq.current) return
      setWords([])
      setWordTotal(0)
      setWordTotalPages(1)
      setWordsError('词表加载失败，请稍后重试。')
    }).finally(() => {
      if (active && seq === wordRequestSeq.current) setWordsLoading(false)
    })
    return () => { active = false }
  }, [activeTab, api, debouncedQuery, id, wordPage, wordsReload])

  useEffect(() => {
    if (!api || !id || activeTab === 'words') return
    let active = true
    setTabLoading(true)
    setTabLoadingMore(false)
    setTabError('')
    const request = activeTab === 'contributions'
      ? api.listCatalogContributions(id).then((page) => {
        if (!active) return
        setContributions(page.items)
        setContributionsNextCursor(page.nextCursor)
      })
      : api.listCatalogRevisions(id).then((page) => {
        if (!active) return
        setRevisions(page.items)
        setRevisionsNextCursor(page.nextCursor)
      })
    if (activeTab === 'contributions') {
      setContributions([])
      setContributionsNextCursor(undefined)
    } else {
      setRevisions([])
      setRevisionsNextCursor(undefined)
    }
    void request.catch(() => {
      if (active) setTabError(activeTab === 'contributions' ? '改进建议暂时无法加载。' : '版本记录暂时无法加载。')
    }).finally(() => {
      if (active) setTabLoading(false)
    })
    return () => { active = false }
  }, [activeTab, api, id])

  async function toggleFavorite() {
    if (!api || !book) return
    try {
      const result = await api.toggleFavorite(book.id)
      setBook((current) => current?.id === book.id ? { ...current, ...result } : current)
    } catch {
      setMessage('收藏操作失败，请稍后重试。')
    }
  }

  async function join() {
    if (!api || !book || book.added) return
    try {
      const result = await api.addCatalog(book.id)
      setBook((current) => current?.id === book.id ? {
        ...current,
        added: true,
        uses: result.created ? current.uses + 1 : current.uses,
      } : current)
      setMessage(result.created ? `已加入「${book.title}」。` : '该词本已在你的学习词本中。')
    } catch {
      setMessage('加入词本失败，请稍后重试。')
    }
  }

  async function prepareContribution() {
    if (!api || !book || preparingContribution) return
    if (!user) {
      setMessage('请先登录账号，再从个人副本提交改进。')
      return
    }
    contributionTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setPreparingContribution(true)
    setMessage('')
    try {
      const copies = await api.listMyWordbooks()
      const source = copies.find((copy) => copy.sourceCatalogId === book.id)
      if (!source) {
        setMessage('没有找到这本词书的个人副本，请重新加入后再试。')
        return
      }
      setContributionBookId(source.id)
    } catch {
      setMessage('个人副本暂时无法读取，请稍后重试。')
    } finally {
      setPreparingContribution(false)
    }
  }

  async function loadMoreHistory() {
    if (!api || tabLoadingMore) return
    const cursor = activeTab === 'contributions' ? contributionsNextCursor : revisionsNextCursor
    if (!cursor || activeTab === 'words') return
    setTabLoadingMore(true)
    setTabError('')
    try {
      if (activeTab === 'contributions') {
        const page = await api.listCatalogContributions(id, cursor)
        setContributions((current) => [...current, ...page.items])
        setContributionsNextCursor(page.nextCursor)
      } else {
        const page = await api.listCatalogRevisions(id, cursor)
        setRevisions((current) => [...current, ...page.items])
        setRevisionsNextCursor(page.nextCursor)
      }
    } catch {
      setTabError(activeTab === 'contributions' ? '更多改进建议加载失败，请稍后重试。' : '更多版本记录加载失败，请稍后重试。')
    } finally {
      setTabLoadingMore(false)
    }
  }

  const selectTab = (tab: DetailTab) => {
    const next = new URLSearchParams()
    if (tab !== 'words') next.set('tab', tab)
    if (marketplaceFrom) next.set('from', marketplaceFrom)
    setSearchParams(next, { replace: true })
  }

  const canonicalMarketplaceSearch = marketplaceFrom ? new URLSearchParams(marketplaceFrom).toString() : ''
  const marketplaceBackHref = canonicalMarketplaceSearch ? `/marketplace?${canonicalMarketplaceSearch}` : '/marketplace'
  const nestedSearch = marketplaceFrom ? `?${new URLSearchParams({ from: marketplaceFrom }).toString()}` : ''
  const normalizedQuery = query.trim()
  const wordBusy = wordsLoading || normalizedQuery !== debouncedQuery
  const firstVisibleWord = wordTotal ? (wordPage - 1) * CATALOG_WORDS_PAGE_SIZE + 1 : 0
  const lastVisibleWord = wordTotal ? firstVisibleWord + words.length - 1 : 0

  if (loading) return <section className="market-detail-state"><EmptyState title="正在加载词本概况" body="正在读取作者和词本信息。" /></section>
  if (!book) return <section className="market-detail-state"><EmptyState title="无法打开词本" body={error} action={<Link to={marketplaceBackHref}>返回单词广场</Link>} /></section>

  return (
    <article className="market-detail-page">
      <Link className="market-detail-back" to={marketplaceBackHref}>← 返回单词广场</Link>
      <header className="market-detail-hero">
        <div>
          <p className="marginal">{book.exams.concat(book.goals).join(' · ') || '共享词本'}</p>
          <h1>{book.title}</h1>
          <p>{book.description || '作者暂未填写简介。'}</p>
          <small>
            作者：{book.author} · 更新于 {new Date(book.updatedAt ?? book.createdAt).toLocaleDateString('zh-CN')}
            {book.headRevisionId ? ` · 版本 ${shortRevision(book.headRevisionId)}` : ''}
          </small>
        </div>
        <div className="market-detail-actions">
          <Button variant="secondary" onClick={() => void toggleFavorite()}>{book.favorited ? '取消收藏' : '收藏'} · {book.favoriteCount}</Button>
          <Button disabled={book.added} onClick={() => void join()}>{book.added ? '已加入词本' : '加入词本'}</Button>
        </div>
      </header>
      {(message || error) && <p className="market-sync-note" role="status">{message || error}</p>}
      <section className="market-detail-metrics" aria-label="词本数据">
        <span><strong>{book.wordCount}</strong> 单词</span>
        <span><strong>{book.favoriteCount}</strong> 收藏</span>
        <span><strong>{book.uses}</strong> 人使用</span>
        <span><strong>{book.openContributionCount ?? 0}</strong> 待审建议</span>
      </section>
      <nav className="market-detail-tabs" aria-label="词书详情">
        <button type="button" aria-current={activeTab === 'words' ? 'page' : undefined} onClick={() => selectTab('words')}>词表</button>
        <button type="button" aria-current={activeTab === 'contributions' ? 'page' : undefined} onClick={() => selectTab('contributions')}>
          改进建议 <span>{book.openContributionCount ?? 0}</span>
        </button>
        <button type="button" aria-current={activeTab === 'revisions' ? 'page' : undefined} onClick={() => selectTab('revisions')}>版本记录</button>
      </nav>

      {activeTab === 'words' && (
        <section className="market-detail-words">
          <header>
            <div><p className="marginal">词表概览</p><h2>全部单词</h2></div>
            <label><span className="sr-only">搜索整本词表</span><input value={query} maxLength={100} onChange={(event) => setQuery(event.target.value)} placeholder="搜索整本词书的单词或释义" /></label>
          </header>
          <p className="market-detail-result" aria-live="polite">
            {wordBusy
              ? (normalizedQuery ? '正在搜索整本词表…' : `正在加载第 ${wordPage} 页…`)
              : debouncedQuery
                ? `整本 ${book.wordCount} 词中找到 ${wordTotal} 个匹配词${wordTotal ? `，显示 ${firstVisibleWord}–${lastVisibleWord}` : ''}`
                : `显示 ${firstVisibleWord}–${lastVisibleWord} / ${wordTotal || book.wordCount} 词`}
          </p>
          {wordsError && <div className="market-detail-word-error" role="alert"><span>{wordsError}</span><button type="button" onClick={() => setWordsReload((value) => value + 1)}>重试</button></div>}
          <div className="market-detail-word-list" ref={wordListRef} aria-busy={wordBusy}>
            {words.map((entry) => (
              <article key={entry.word}>
                <div><strong>{entry.word}</strong><small>{entry.phonetic || '暂无音标'}</small></div>
                <p>{entry.zhMeaning || entry.meanings[0]?.definition || '暂无释义'}</p>
                <small>{entry.meanings.slice(0, 2).map((meaning) => `${meaning.pos} ${meaning.definition}`).join('；')}</small>
              </article>
            ))}
            {!wordBusy && !wordsError && !words.length && <p className="market-detail-empty">没有匹配的单词。</p>}
          </div>
          {!wordsError && wordTotalPages > 1 && <nav className="market-detail-pagination" aria-label="词表分页">
            <button type="button" disabled={wordBusy || wordPage <= 1} onClick={() => setWordPage((page) => Math.max(1, page - 1))}>上一页</button>
            <span>第 {wordPage} / {wordTotalPages} 页</span>
            <button type="button" disabled={wordBusy || wordPage >= wordTotalPages} onClick={() => setWordPage((page) => Math.min(wordTotalPages, page + 1))}>下一页</button>
          </nav>}
        </section>
      )}

      {activeTab === 'contributions' && (
        <section className="market-collab-panel" aria-labelledby="contributions-title">
          <header>
            <div><p className="marginal">社区协作</p><h2 id="contributions-title">改进建议</h2></div>
            {book.added && book.collaborationEnabled && (
              <button
                className="market-collab-submit"
                type="button"
                disabled={authLoading || preparingContribution}
                onClick={() => { void prepareContribution() }}
              >
                {preparingContribution ? '正在准备预览…' : '从个人副本提交'}
              </button>
            )}
          </header>
          {tabLoading && <p className="collab-state" role="status">正在加载改进建议…</p>}
          {tabError && <p className="collab-error" role="alert">{tabError}</p>}
          {!tabLoading && !tabError && contributions.length === 0 && (
            <EmptyState title="还没有改进建议" body={book.collaborationEnabled ? '加入词书并完善个人副本后，可以提交第一条建议。' : '这个词书当前未开放协作。'} />
          )}
          <div className="market-collab-list">
            {contributions.map((contribution) => (
              <Link key={contribution.id} to={`/marketplace/${book.id}/contributions/${contribution.id}${nestedSearch}`}>
                <span className={`collab-status collab-status--${contribution.status}`}>{CONTRIBUTION_STATUS[contribution.status]}</span>
                <div>
                  <strong>{contribution.title}</strong>
                  <small>{contribution.contributor} 提交于 {new Date(contribution.createdAt).toLocaleString('zh-CN')}</small>
                </div>
                <ChangeStats {...contribution.stats} />
              </Link>
            ))}
          </div>
          {contributionsNextCursor && <div className="collab-load-more"><Button variant="secondary" disabled={tabLoadingMore} onClick={() => void loadMoreHistory()}>{tabLoadingMore ? '正在加载…' : '加载更多建议'}</Button></div>}
        </section>
      )}

      {activeTab === 'revisions' && (
        <section className="market-collab-panel" aria-labelledby="revisions-title">
          <header><div><p className="marginal">不可变历史</p><h2 id="revisions-title">版本记录</h2></div></header>
          {tabLoading && <p className="collab-state" role="status">正在加载版本记录…</p>}
          {tabError && <p className="collab-error" role="alert">{tabError}</p>}
          <div className="market-collab-list market-revision-list">
            {revisions.map((revision) => (
              <Link key={revision.id} to={`/marketplace/${book.id}/revisions/${revision.id}${nestedSearch}`}>
                <span className={`revision-kind revision-kind--${revision.kind}`}>{REVISION_KIND[revision.kind]}</span>
                <div>
                  <strong>{revision.message}</strong>
                  <small>{revision.author}{revision.committer ? `，由 ${revision.committer} 合并` : ''} · {new Date(revision.createdAt).toLocaleString('zh-CN')} · {shortRevision(revision.id)}</small>
                </div>
                <ChangeStats {...revision.stats} />
              </Link>
            ))}
          </div>
          {revisionsNextCursor && <div className="collab-load-more"><Button variant="secondary" disabled={tabLoadingMore} onClick={() => void loadMoreHistory()}>{tabLoadingMore ? '正在加载…' : '加载更多版本'}</Button></div>}
        </section>
      )}
      {contributionBookId && <ContributionSubmitDialog
        wordbookId={contributionBookId}
        returnFocus={contributionTriggerRef.current}
        onClose={() => setContributionBookId(null)}
        onSubmitted={(contribution) => {
          setContributionBookId(null)
          setContributions((current) => [contribution, ...current.filter((item) => item.id !== contribution.id)])
          setBook((current) => current ? { ...current, openContributionCount: (current.openContributionCount ?? 0) + 1 } : current)
          setMessage(`改进建议「${contribution.title}」已提交。`)
        }}
      />}
    </article>
  )
}
