import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { ContributionSubmitDialog } from '../components/marketplace/ContributionSubmitDialog'
import {
  getWorkspaceApi,
  type CatalogContribution,
  type CatalogDetail,
  type CatalogRevision,
} from '../data/workspaceApi'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useAuth } from '../hooks/useAuth'

type DetailTab = 'words' | 'contributions' | 'revisions'

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
  const activeTab: DetailTab = requestedTab === 'contributions' || requestedTab === 'revisions'
    ? requestedTab
    : 'words'
  const api = getWorkspaceApi()
  const { user, loading: authLoading } = useAuth()
  const [book, setBook] = useState<CatalogDetail | null>(null)
  const [contributions, setContributions] = useState<CatalogContribution[]>([])
  const [revisions, setRevisions] = useState<CatalogRevision[]>([])
  const [loading, setLoading] = useState(true)
  const [tabLoading, setTabLoading] = useState(false)
  const [error, setError] = useState('')
  const [tabError, setTabError] = useState('')
  const [query, setQuery] = useState('')
  const [message, setMessage] = useState('')
  const [preparingContribution, setPreparingContribution] = useState(false)
  const [contributionBookId, setContributionBookId] = useState<string | null>(null)
  useDocumentTitle(book?.title ? `${book.title} · 单词广场` : '词本概况')

  const load = async () => {
    if (!api || !id) {
      setError('无法读取该词本。')
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      setBook(await api.getCatalog(id))
      setError('')
    } catch {
      setBook(null)
      setError('该词本不存在、不可见或暂时无法加载。')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [id])

  useEffect(() => {
    if (!api || !id || activeTab === 'words') return
    let active = true
    setTabLoading(true)
    setTabError('')
    const request = activeTab === 'contributions'
      ? api.listCatalogContributions(id).then((page) => {
        if (active) setContributions(page.items)
      })
      : api.listCatalogRevisions(id).then((page) => {
        if (active) setRevisions(page.items)
      })
    void request.catch(() => {
      if (active) setTabError(activeTab === 'contributions' ? '改进建议暂时无法加载。' : '版本记录暂时无法加载。')
    }).finally(() => {
      if (active) setTabLoading(false)
    })
    return () => { active = false }
  }, [activeTab, api, id])

  const words = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return book?.words ?? []
    return (book?.words ?? []).filter((entry) =>
      [entry.word, entry.phonetic, entry.zhMeaning, ...entry.meanings.flatMap((meaning) => [meaning.pos, meaning.definition])]
        .filter(Boolean).join(' ').toLowerCase().includes(normalized))
  }, [book?.words, query])

  async function toggleFavorite() {
    if (!api || !book) return
    try {
      const result = await api.toggleFavorite(book.id)
      setBook({ ...book, ...result })
    } catch {
      setMessage('收藏操作失败，请稍后重试。')
    }
  }

  async function join() {
    if (!api || !book || book.added) return
    try {
      const result = await api.addCatalog(book.id)
      setBook(await api.getCatalog(book.id))
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

  const selectTab = (tab: DetailTab) => {
    if (tab === 'words') setSearchParams({}, { replace: true })
    else setSearchParams({ tab }, { replace: true })
  }

  if (loading) return <section className="market-detail-state"><EmptyState title="正在加载词本概况" body="正在读取作者和单词列表。" /></section>
  if (!book) return <section className="market-detail-state"><EmptyState title="无法打开词本" body={error} action={<Link to="/marketplace">返回单词广场</Link>} /></section>

  return (
    <article className="market-detail-page">
      <Link className="market-detail-back" to="/marketplace">← 返回单词广场</Link>
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
            <label><span className="sr-only">搜索词表</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索单词或释义" /></label>
          </header>
          <p className="market-detail-result">显示 {words.length} / {book.wordCount} 词</p>
          <div className="market-detail-word-list">
            {words.map((entry) => (
              <article key={entry.word}>
                <div><strong>{entry.word}</strong><small>{entry.phonetic || '暂无音标'}</small></div>
                <p>{entry.zhMeaning || entry.meanings[0]?.definition || '暂无释义'}</p>
                <small>{entry.meanings.slice(0, 2).map((meaning) => `${meaning.pos} ${meaning.definition}`).join('；')}</small>
              </article>
            ))}
            {!words.length && <p className="market-detail-empty">没有匹配的单词。</p>}
          </div>
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
              <Link key={contribution.id} to={`/marketplace/${book.id}/contributions/${contribution.id}`}>
                <span className={`collab-status collab-status--${contribution.status}`}>{CONTRIBUTION_STATUS[contribution.status]}</span>
                <div>
                  <strong>{contribution.title}</strong>
                  <small>{contribution.contributor} 提交于 {new Date(contribution.createdAt).toLocaleString('zh-CN')}</small>
                </div>
                <ChangeStats {...contribution.stats} />
              </Link>
            ))}
          </div>
        </section>
      )}

      {activeTab === 'revisions' && (
        <section className="market-collab-panel" aria-labelledby="revisions-title">
          <header><div><p className="marginal">不可变历史</p><h2 id="revisions-title">版本记录</h2></div></header>
          {tabLoading && <p className="collab-state" role="status">正在加载版本记录…</p>}
          {tabError && <p className="collab-error" role="alert">{tabError}</p>}
          <div className="market-collab-list market-revision-list">
            {revisions.map((revision) => (
              <Link key={revision.id} to={`/marketplace/${book.id}/revisions/${revision.id}`}>
                <span className={`revision-kind revision-kind--${revision.kind}`}>{REVISION_KIND[revision.kind]}</span>
                <div>
                  <strong>{revision.message}</strong>
                  <small>{revision.author}{revision.committer ? `，由 ${revision.committer} 合并` : ''} · {new Date(revision.createdAt).toLocaleString('zh-CN')} · {shortRevision(revision.id)}</small>
                </div>
                <ChangeStats {...revision.stats} />
              </Link>
            ))}
          </div>
        </section>
      )}
      {contributionBookId && <ContributionSubmitDialog
        wordbookId={contributionBookId}
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
