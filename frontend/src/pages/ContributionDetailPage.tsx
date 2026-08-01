import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { CatalogDiff } from '../components/marketplace/CatalogDiff'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import {
  getWorkspaceApi,
  WorkspaceApiError,
  type CatalogContribution,
} from '../data/workspaceApi'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

const STATUS: Record<CatalogContribution['status'], string> = {
  open: '待审核',
  merged: '已合并',
  closed: '已关闭',
}

function actionError(error: unknown): string {
  if (error instanceof WorkspaceApiError) {
    if (error.code === 'CONTRIBUTION_CONFLICT') return '公开版本或发布者源词书存在重叠修改，本次没有写入任何变化。'
    if (error.code === 'CONTRIBUTION_STALE') return '公开版本已变化，请刷新后重新审核。'
    if (error.code === 'CONTRIBUTION_FORBIDDEN') return '当前账号没有处理这条建议的权限。'
  }
  return '操作失败，请稍后重试。'
}

export function ContributionDetailPage() {
  const { id = '', contributionId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const marketplaceFrom = (searchParams.get('from') ?? '').slice(0, 2_000)
  const detailParams = new URLSearchParams({ tab: 'contributions' })
  if (marketplaceFrom) detailParams.set('from', marketplaceFrom)
  const contributionListHref = `/marketplace/${id}?${detailParams.toString()}`
  const nestedSearch = marketplaceFrom ? `?${new URLSearchParams({ from: marketplaceFrom }).toString()}` : ''
  const api = getWorkspaceApi()
  const [contribution, setContribution] = useState<CatalogContribution | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [resolutionNote, setResolutionNote] = useState('')
  const [error, setError] = useState('')
  useDocumentTitle(contribution ? `${contribution.title} · 改进建议` : '改进建议')

  useEffect(() => {
    if (!api || !id || !contributionId) {
      setLoading(false)
      setError('无法读取这条改进建议。')
      return
    }
    let active = true
    setLoading(true)
    void api.getCatalogContribution(id, contributionId)
      .then((result) => {
        if (!active) return
        setContribution(result)
        setError('')
      })
      .catch(() => {
        if (!active) return
        setError('建议不存在、不可见或暂时无法加载。')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [api, contributionId, id])

  async function merge() {
    if (!api || !contribution || submitting) return
    setSubmitting(true)
    setError('')
    try {
      setContribution(await api.mergeContribution(id, contribution.id, {
        resolutionNote: resolutionNote.trim(),
      }))
    } catch (caught) {
      setError(actionError(caught))
    } finally {
      setSubmitting(false)
    }
  }

  async function close() {
    if (!api || !contribution || submitting) return
    setSubmitting(true)
    setError('')
    try {
      setContribution(await api.closeContribution(id, contribution.id, resolutionNote.trim()))
    } catch (caught) {
      setError(actionError(caught))
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <section className="market-detail-state"><EmptyState title="正在加载改进建议" body="正在读取提交说明和词条差异。" /></section>
  if (!contribution) return <section className="market-detail-state"><EmptyState title="无法打开改进建议" body={error} action={<Link to={contributionListHref}>返回建议列表</Link>} /></section>

  return (
    <article className="collab-detail-page">
      <Link className="market-detail-back" to={contributionListHref}>← 返回改进建议</Link>
      <header className="collab-detail-hero">
        <div>
          <p className="marginal">改进建议 · {contribution.catalogTitle}</p>
          <h1>{contribution.title}</h1>
          <p>{contribution.description || '提交者没有填写补充说明。'}</p>
          <small>{contribution.contributor} 提交于 {new Date(contribution.createdAt).toLocaleString('zh-CN')}</small>
        </div>
        <span className={`collab-status collab-status--${contribution.status}`}>{STATUS[contribution.status]}</span>
      </header>

      {error && <p className="collab-error" role="alert">{error}</p>}

      {contribution.status === 'open' && (contribution.canMerge || contribution.canClose) && (
        <section className="collab-review-actions" aria-labelledby="review-actions-title">
          <div>
            <h2 id="review-actions-title">{contribution.canMerge ? '审核此建议' : '管理我的建议'}</h2>
            <p>{contribution.canMerge ? '合并会原子更新公开词书和你的发布源词书，并创建一个新版本。' : '撤回后建议将关闭，历史差异仍可查看。'}</p>
          </div>
          <label>
            <span>处理说明，可不填</span>
            <textarea value={resolutionNote} maxLength={500} rows={3} onChange={(event) => setResolutionNote(event.target.value)} />
          </label>
          <div>
            {contribution.canClose && <Button variant="secondary" disabled={submitting} onClick={() => void close()}>{contribution.canMerge ? '关闭建议' : '撤回建议'}</Button>}
            {contribution.canMerge && <Button disabled={submitting} onClick={() => void merge()}>{submitting ? '正在处理…' : '合并全部变化'}</Button>}
          </div>
        </section>
      )}

      {contribution.status !== 'open' && (
        <section className="collab-resolution">
          <strong>{STATUS[contribution.status]}</strong>
          <p>{contribution.handledBy ? `由 ${contribution.handledBy} 处理。` : '建议已处理。'} {contribution.resolutionNote}</p>
          {contribution.mergedRevisionId && <Link to={`/marketplace/${id}/revisions/${contribution.mergedRevisionId}${nestedSearch}`}>查看合并版本</Link>}
        </section>
      )}

      <section className="collab-detail-diff" aria-labelledby="contribution-diff-title">
        <header>
          <div><p className="marginal">公开审计</p><h2 id="contribution-diff-title">词条变化</h2></div>
          <small>基于版本 {contribution.baseRevisionId.replace(/^revision-/, '').slice(0, 8)}</small>
        </header>
        <CatalogDiff changes={contribution.changes} />
      </section>
    </article>
  )
}
