import { useEffect, useRef, useState, type FormEvent } from 'react'
import { getWorkspaceApi, WorkspaceApiError, type CatalogContribution, type ContributionPreview } from '../../data/workspaceApi'
import { Button } from '../ui/Button'
import { CatalogDiff } from './CatalogDiff'

function submitError(error: unknown): string {
  if (error instanceof WorkspaceApiError) {
    if (error.code === 'CONTRIBUTION_ALREADY_OPEN') return '你已经有一条待处理建议，请等待处理或先撤回。'
    if (error.code === 'CONTRIBUTION_STALE') return '个人副本或公开版本刚刚变化，请关闭后重新预览。'
    if (error.code === 'CONTRIBUTION_EMPTY') return '当前没有可提交的公开词条变化。'
    if (error.code === 'COLLABORATION_DISABLED') return '发布者暂未开放这个词书的协作。'
    if (error.code === 'AUTH_REQUIRED') return '请先登录账号再提交建议。'
  }
  return '提交失败，请稍后重试。'
}

export function ContributionSubmitDialog({
  wordbookId,
  onClose,
  onSubmitted,
}: {
  wordbookId: string
  onClose: () => void
  onSubmitted: (contribution: CatalogContribution) => void
}) {
  const api = getWorkspaceApi()
  const titleRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<ContributionPreview | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [legacyConfirmed, setLegacyConfirmed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!api) {
      setError('未配置后端地址。')
      setLoading(false)
      return
    }
    let active = true
    void api.getContributionPreview(wordbookId)
      .then((result) => {
        if (!active) return
        setPreview(result)
        setError('')
        window.setTimeout(() => titleRef.current?.focus(), 0)
      })
      .catch((caught) => {
        if (!active) return
        setError(caught instanceof WorkspaceApiError && caught.status === 401
          ? '请先登录账号再提交建议。'
          : '无法生成改进预览。词书可能已停止公开协作。')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [api, wordbookId])

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) onClose()
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose, submitting])

  const valid = Boolean(
    preview
    && preview.changes.length > 0
    && preview.changes.length <= 500
    && title.trim().length >= 2
    && title.trim().length <= 80
    && description.trim().length <= 1000
    && (!preview.legacyBaseline || legacyConfirmed),
  )

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!api || !preview || !valid || submitting) return
    setSubmitting(true)
    setError('')
    try {
      const contribution = await api.createContribution(preview.catalogId, {
        title: title.trim(),
        description: description.trim(),
        expectedSourceUpdatedAt: preview.expectedSourceUpdatedAt,
        expectedHeadRevisionId: preview.expectedHeadRevisionId,
      })
      onSubmitted(contribution)
    } catch (caught) {
      setError(submitError(caught))
      setSubmitting(false)
    }
  }

  return (
    <div className="collab-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (!submitting && event.target === event.currentTarget) onClose()
    }}>
      <section className="collab-modal" role="dialog" aria-modal="true" aria-labelledby="contribution-submit-title">
        <header className="collab-modal__header">
          <div>
            <p className="marginal">协作建议</p>
            <h2 id="contribution-submit-title">提交改进</h2>
          </div>
          <button type="button" aria-label="关闭" disabled={submitting} onClick={onClose}>×</button>
        </header>
        <div className="collab-modal__body">
          {loading && <p className="collab-state" role="status">正在比较个人副本与公开版本…</p>}
          {error && <p className="collab-error" role="alert">{error}</p>}
          {preview && (
            <form id="contribution-submit-form" onSubmit={submit}>
              <div className="collab-form-grid">
                <label>
                  <span>建议标题</span>
                  <input
                    ref={titleRef}
                    value={title}
                    minLength={2}
                    maxLength={80}
                    required
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="简要说明这次改进"
                  />
                  <small>{title.trim().length} / 80，至少 2 个字</small>
                </label>
                <label>
                  <span>补充说明</span>
                  <textarea
                    value={description}
                    maxLength={1000}
                    rows={4}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="说明修改依据或使用场景，可不填"
                  />
                  <small>{description.trim().length} / 1000</small>
                </label>
              </div>
              {preview.overlaps.length > 0 && (
                <p className="collab-warning" role="status">
                  有 {preview.overlaps.length} 个词条同时被发布者修改。下方预览已把你的修改重放到最新版，请重点检查。
                </p>
              )}
              {preview.legacyBaseline && (
                <label className="collab-confirm">
                  <input
                    type="checkbox"
                    checked={legacyConfirmed}
                    onChange={(event) => setLegacyConfirmed(event.target.checked)}
                  />
                  <span>这是旧版个人副本，我已检查并确认下方完整差异。</span>
                </label>
              )}
              <CatalogDiff changes={preview.changes} emptyMessage="个人副本与公开版没有可提交的词条变化。" />
            </form>
          )}
        </div>
        <footer className="collab-modal__footer">
          <Button variant="secondary" disabled={submitting} onClick={onClose}>取消</Button>
          <Button form="contribution-submit-form" type="submit" disabled={!valid || submitting}>
            {submitting ? '正在提交…' : '提交给发布者'}
          </Button>
        </footer>
      </section>
    </div>
  )
}

