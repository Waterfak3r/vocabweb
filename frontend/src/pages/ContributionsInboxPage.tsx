import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { getWorkspaceApi, type CatalogContribution } from '../data/workspaceApi'
import { useAuth } from '../hooks/useAuth'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

const STATUS: Record<CatalogContribution['status'], string> = {
  open: '待审核',
  merged: '已合并',
  closed: '已关闭',
}

export function ContributionsInboxPage() {
  useDocumentTitle('协作收件箱')
  const { user, loading: authLoading } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const scope = searchParams.get('scope') === 'authored' ? 'authored' : 'review'
  const api = getWorkspaceApi()
  const [items, setItems] = useState<CatalogContribution[]>([])
  const [nextCursor, setNextCursor] = useState<string>()
  const [openCount, setOpenCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (authLoading) return
    if (!api || !user) {
      setItems([])
      setLoading(false)
      return
    }
    let active = true
    setLoading(true)
    setError('')
    void api.listAccountContributions(scope)
      .then((page) => {
        if (!active) return
        setItems(page.items)
        setNextCursor(page.nextCursor)
        setOpenCount(page.openCount)
      })
      .catch(() => {
        if (active) setError('协作收件箱暂时无法加载。')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [api, authLoading, scope, user])

  async function loadMore() {
    if (!api || !nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const page = await api.listAccountContributions(scope, nextCursor)
      setItems((current) => [...current, ...page.items])
      setNextCursor(page.nextCursor)
      setOpenCount(page.openCount)
    } catch {
      setError('更多建议加载失败，请稍后重试。')
    } finally {
      setLoadingMore(false)
    }
  }

  if (!authLoading && !user) {
    return <section className="market-detail-state"><EmptyState title="登录后查看协作收件箱" body="发布者可以审核建议，贡献者可以跟踪自己提交的改进。" action={<Link to="/account">前往账号页</Link>} /></section>
  }

  return (
    <main className="collab-inbox-page">
      <header className="collab-inbox-hero">
        <div>
          <p className="marginal">Collaborative wordbooks</p>
          <h1>协作收件箱</h1>
          <p>审核社区提出的词条变化，或跟踪自己提交的改进建议。</p>
        </div>
        <strong><span>{openCount}</span> 条待处理</strong>
      </header>
      <nav className="market-detail-tabs" aria-label="协作收件箱分类">
        <button type="button" aria-current={scope === 'review' ? 'page' : undefined} onClick={() => setSearchParams({ scope: 'review' })}>待我审核</button>
        <button type="button" aria-current={scope === 'authored' ? 'page' : undefined} onClick={() => setSearchParams({ scope: 'authored' })}>我提交的</button>
      </nav>
      {loading && <p className="collab-state" role="status">正在加载协作建议…</p>}
      {error && <p className="collab-error" role="alert">{error}</p>}
      {!loading && !error && items.length === 0 && (
        <EmptyState title={scope === 'review' ? '暂无待审核建议' : '还没有提交建议'} body={scope === 'review' ? '公开词书收到建议后会出现在这里。' : '从广场加入词书，完善个人副本后即可提交。'} />
      )}
      <section className="collab-inbox-list" aria-label={scope === 'review' ? '待我审核' : '我提交的'}>
        {items.map((item) => (
          <Link key={item.id} to={`/marketplace/${item.catalogId}/contributions/${item.id}`}>
            <div className="collab-inbox-list__book">
              <span>{item.catalogTitle.slice(0, 1)}</span>
              <small>{item.catalogTitle}</small>
            </div>
            <div className="collab-inbox-list__main">
              <span className={`collab-status collab-status--${item.status}`}>{STATUS[item.status]}</span>
              <strong>{item.title}</strong>
              <small>{item.contributor} · {new Date(item.createdAt).toLocaleString('zh-CN')}</small>
            </div>
            <span className="collab-list-stats">
              <b>+{item.stats.additions}</b>
              <i>-{item.stats.deletions}</i>
              <span>{item.stats.updates} 改</span>
            </span>
          </Link>
        ))}
      </section>
      {nextCursor && <div className="collab-load-more"><Button variant="secondary" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? '正在加载…' : '加载更多'}</Button></div>}
    </main>
  )
}

