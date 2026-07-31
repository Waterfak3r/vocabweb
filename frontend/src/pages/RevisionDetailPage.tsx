import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { CatalogDiff } from '../components/marketplace/CatalogDiff'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import {
  getWorkspaceApi,
  WorkspaceApiError,
  type CatalogRevision,
  type RevertPreview,
} from '../data/workspaceApi'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

const KIND: Record<CatalogRevision['kind'], string> = {
  initial: '首次发布',
  update: '发布者更新',
  merge: '合并建议',
  revert: '回滚',
}

function revertError(error: unknown): string {
  if (error instanceof WorkspaceApiError) {
    if (error.code === 'REVISION_REVERT_CONFLICT') return '后续版本修改了相同词条，本次没有写入任何变化。'
    if (error.code === 'REVISION_ALREADY_REVERTED') return '这个版本的变化已经全部撤销。'
    if (error.code === 'REVISION_HEAD_STALE') return '词书刚刚产生了新版本，请重新生成回滚预览。'
  }
  return '回滚失败，请稍后重试。'
}

export function RevisionDetailPage() {
  const { id = '', revisionId = '' } = useParams()
  const navigate = useNavigate()
  const api = getWorkspaceApi()
  const [revision, setRevision] = useState<CatalogRevision | null>(null)
  const [preview, setPreview] = useState<RevertPreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  useDocumentTitle(revision ? `${revision.message} · 版本记录` : '版本记录')

  useEffect(() => {
    if (!api || !id || !revisionId) {
      setLoading(false)
      setError('无法读取这个版本。')
      return
    }
    let active = true
    setLoading(true)
    void api.getCatalogRevision(id, revisionId)
      .then((result) => {
        if (active) setRevision(result)
      })
      .catch(() => {
        if (active) setError('版本不存在、不可见或暂时无法加载。')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [api, id, revisionId])

  async function openRevert() {
    if (!api || !revision || previewLoading) return
    setPreviewLoading(true)
    setError('')
    try {
      setPreview(await api.getRevertPreview(id, revision.id))
    } catch {
      setError('无法生成回滚预览。词书可能已停止公开协作。')
    } finally {
      setPreviewLoading(false)
    }
  }

  async function confirmRevert() {
    if (!api || !revision || !preview || preview.conflicts.length || preview.alreadyReverted || submitting) return
    setSubmitting(true)
    setError('')
    try {
      const created = await api.revertRevision(id, revision.id, {
        expectedHeadRevisionId: preview.headRevisionId,
        ...(message.trim() ? { message: message.trim() } : {}),
      })
      navigate(`/marketplace/${id}/revisions/${created.id}`)
    } catch (caught) {
      setError(revertError(caught))
      setPreview(null)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <section className="market-detail-state"><EmptyState title="正在加载版本" body="正在读取不可变差异和版本关系。" /></section>
  if (!revision) return <section className="market-detail-state"><EmptyState title="无法打开版本" body={error} action={<Link to={`/marketplace/${id}?tab=revisions`}>返回版本记录</Link>} /></section>

  return (
    <article className="collab-detail-page">
      <Link className="market-detail-back" to={`/marketplace/${id}?tab=revisions`}>← 返回版本记录</Link>
      <header className="collab-detail-hero">
        <div>
          <p className="marginal">{KIND[revision.kind]} · {revision.catalogTitle}</p>
          <h1>{revision.message}</h1>
          <p>
            {revision.author} 创建于 {new Date(revision.createdAt).toLocaleString('zh-CN')}
            {revision.committer ? `，由 ${revision.committer} 合并` : ''}
          </p>
          <small>版本 {revision.id.replace(/^revision-/, '').slice(0, 8)}</small>
        </div>
        {revision.canRevert && <Button variant="secondary" disabled={previewLoading} onClick={() => void openRevert()}>{previewLoading ? '正在生成预览…' : '回滚此版本'}</Button>}
      </header>

      {error && <p className="collab-error" role="alert">{error}</p>}

      <div className="collab-version-links">
        {revision.contributionId && <Link to={`/marketplace/${id}/contributions/${revision.contributionId}`}>查看关联建议</Link>}
        {revision.revertsRevisionId && <Link to={`/marketplace/${id}/revisions/${revision.revertsRevisionId}`}>查看被回滚版本</Link>}
      </div>

      <section className="collab-detail-diff" aria-labelledby="revision-diff-title">
        <header><div><p className="marginal">版本审计</p><h2 id="revision-diff-title">这个版本做了什么</h2></div></header>
        <CatalogDiff changes={revision.changes} emptyMessage="这个版本只更新了词书资料，没有修改词条。" />
      </section>

      {preview && (
        <div className="collab-modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (!submitting && event.target === event.currentTarget) setPreview(null)
        }}>
          <section className="collab-modal" role="alertdialog" aria-modal="true" aria-labelledby="revert-preview-title">
            <header className="collab-modal__header">
              <div><p className="marginal">反向版本预览</p><h2 id="revert-preview-title">确认回滚此版本</h2></div>
              <button type="button" aria-label="关闭" disabled={submitting} onClick={() => setPreview(null)}>×</button>
            </header>
            <div className="collab-modal__body">
              <p className="collab-state">回滚不会删除历史。确认后将新增一个包含下列反向变化的版本。</p>
              {preview.conflicts.length > 0 && <p className="collab-error" role="alert">有 {preview.conflicts.length} 个词条已被后续版本修改，当前不能回滚。</p>}
              {preview.alreadyReverted && <p className="collab-warning">这个版本的变化已经全部撤销，不会创建空版本。</p>}
              <label className="collab-revert-message">
                <span>版本说明，可不填</span>
                <input value={message} maxLength={80} onChange={(event) => setMessage(event.target.value)} placeholder={`回滚 ${revision.id.replace(/^revision-/, '').slice(0, 8)}`} />
              </label>
              <CatalogDiff changes={preview.changes} emptyMessage="没有可执行的反向变化。" />
            </div>
            <footer className="collab-modal__footer">
              <Button variant="secondary" disabled={submitting} onClick={() => setPreview(null)}>取消</Button>
              <Button variant="danger" disabled={submitting || preview.conflicts.length > 0 || preview.alreadyReverted} onClick={() => void confirmRevert()}>{submitting ? '正在回滚…' : '创建回滚版本'}</Button>
            </footer>
          </section>
        </div>
      )}
    </article>
  )
}

