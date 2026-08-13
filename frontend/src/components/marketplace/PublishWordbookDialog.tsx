import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import {
  getWorkspaceApi,
  WorkspaceApiError,
  type CatalogVisibility,
  type CatalogWordbook,
  type MyWordbook,
} from '../../data/workspaceApi'
import { useModalDialog } from '../../hooks/useModalDialog'
import {
  hasOpenVisibilityChanges,
  isAuthRequiredError,
  isSnapshotSourceLocked,
  MARKETPLACE_TITLE_MAX_LENGTH,
  marketplaceTitleError,
  PUBLISH_EXAMS,
  PUBLISH_GOALS,
  UPLOAD_LOGIN_HINT,
  VISIBILITY_LABELS,
  VISIBILITY_OPTIONS,
  type PublishCatalogInput,
} from './publishWordbook'

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

const EMPTY_PUBLISH_FORM: PublishForm = {
  sourceWordbookId: '',
  title: '',
  description: '',
  exam: '',
  goal: '',
  visibility: 'public',
  revisionMessage: '',
}

function BookCover({ tone, label }: { tone: 'blue'; label: string }) {
  return <div className={`book-cover cover-${tone}`} aria-hidden="true"><span>{label}</span><i /></div>
}

export function PublishWordbookDialog({
  target,
  preferredSourceWordbookId,
  isLoggedIn,
  onClose,
  onFinished,
}: {
  target: CatalogWordbook | null
  preferredSourceWordbookId?: string
  isLoggedIn: boolean
  onClose: () => void
  onFinished: (message: string) => void
}) {
  const api = getWorkspaceApi()
  const [step, setStep] = useState<PublishStep>('details')
  const [form, setForm] = useState<PublishForm>(EMPTY_PUBLISH_FORM)
  const [personalWordbooks, setPersonalWordbooks] = useState<MyWordbook[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const dialogRef = useModalDialog<HTMLElement>({
    open: true,
    onClose,
    canClose: !loading,
  })
  const selectedSource = personalWordbooks.find((book) => book.id === form.sourceWordbookId)
  const snapshotSourceLocked = isSnapshotSourceLocked(target?.sourceWordbookId, personalWordbooks)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    if (!api) {
      setError('未配置后端，无法读取个人词本。')
      setLoading(false)
      return () => { active = false }
    }
    void api.listMyWordbooks().then((wordbooks) => {
      if (!active) return
      const available = wordbooks.filter((book) => book.wordCount > 0)
      // Never guess an update source from the currently viewed book or a display title.
      const matchingBook = target
        ? wordbooks.find((book) => book.id === target.sourceWordbookId)
        : preferredSourceWordbookId
          ? wordbooks.find((book) => book.id === preferredSourceWordbookId) ?? available[0]
          : available[0]
      setPersonalWordbooks(target && matchingBook ? [matchingBook] : available)
      let visibility: CatalogVisibility = target?.visibility ?? 'public'
      if (!isLoggedIn && visibility === 'public') visibility = 'unlisted'
      setForm({
        sourceWordbookId: matchingBook?.id ?? '',
        title: target?.title ?? matchingBook?.title ?? '',
        description: target?.description ?? matchingBook?.description ?? '',
        exam: target?.exams[0] ?? '',
        goal: target?.goals[0] ?? '',
        visibility,
        revisionMessage: target ? '更新词书' : '首次发布',
      })
      if (target && matchingBook && matchingBook.wordCount === 0) {
        setError('原发布源当前没有词条，请先补充词条后再更新快照。')
      } else if (!available.length) {
        setError('请先在“我的单词本”创建并导入至少一个非空词本。')
      } else if (target && !matchingBook) {
        setError('为避免更新错词本，请重新选择这次快照的来源。')
      }
    }).catch(() => {
      if (active) setError('个人词本加载失败，请稍后重试。')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [api, isLoggedIn, preferredSourceWordbookId, target])

  function chooseSourceWordbook(sourceWordbookId: string) {
    if (snapshotSourceLocked && sourceWordbookId !== target?.sourceWordbookId) return
    setForm((current) => {
      const nextBook = personalWordbooks.find((book) => book.id === sourceWordbookId)
      const previousBook = personalWordbooks.find((book) => book.id === current.sourceWordbookId)
      const title = !current.title || current.title === previousBook?.title ? (nextBook?.title ?? '') : current.title
      const description = !current.description || current.description === previousBook?.description
        ? (nextBook?.description ?? '')
        : current.description
      return { ...current, sourceWordbookId, title, description }
    })
  }

  function openPreview() {
    if (!selectedSource) {
      setError('请选择一个非空词本。')
      return
    }
    if (selectedSource.wordCount === 0) {
      setError('原发布源当前没有词条，请先补充词条后再更新快照。')
      return
    }
    const titleError = marketplaceTitleError(form.title)
    if (titleError) {
      setError(titleError)
      return
    }
    setError('')
    setStep('preview')
  }

  async function submit() {
    if (!api || !selectedSource || !form.title.trim()) return
    if (hasOpenVisibilityChanges(target?.visibility, target?.openContributionCount) && form.visibility !== 'public') {
      setForm((current) => ({ ...current, visibility: 'public' }))
      setError('还有待处理建议，请先处理后再更改可见性。')
      return
    }
    if (target && !target.headRevisionId) {
      setStep('details')
      setError('当前上传缺少版本信息，请刷新后重新打开更新窗口。')
      return
    }
    const input: PublishCatalogInput = {
      sourceWordbookId: selectedSource.id,
      ...(target ? { expectedHeadRevisionId: target.headRevisionId } : {}),
      title: form.title.trim(),
      description: form.description.trim(),
      exams: form.exam ? [form.exam] : [],
      goals: form.goal ? [form.goal] : [],
      visibility: form.visibility,
      message: form.revisionMessage.trim() || (target ? '更新词书' : '首次发布'),
    }
    setLoading(true)
    setError('')
    try {
      if (target) {
        await api.updateCatalogSnapshot(target.id, input)
        onFinished(`「${input.title}」的社区快照已更新。已加入的用户词本不会受影响。`)
      } else {
        await api.uploadWordbook(input)
        onFinished(`「${input.title}」已作为独立快照发布到单词广场。`)
      }
    } catch (caught) {
      if (caught instanceof WorkspaceApiError && (
        caught.code === 'CATALOG_HEAD_REQUIRED'
        || caught.code === 'CATALOG_HEAD_STALE'
        || caught.code === 'CATALOG_SOURCE_MISMATCH'
      )) {
        onFinished(caught.code === 'CATALOG_SOURCE_MISMATCH'
          ? '快照未更新：该上传已绑定另一发布源，请重新打开并使用原发布源。'
          : '快照未更新：广场版本已经变化，请重新打开更新窗口确认最新内容。')
      } else if (caught instanceof WorkspaceApiError && caught.code === 'CATALOG_OPEN_CONTRIBUTIONS') {
        const count = typeof caught.details?.openContributionCount === 'number'
          ? caught.details.openContributionCount
          : target?.openContributionCount ?? 0
        setStep('details')
        setForm((current) => ({ ...current, visibility: 'public' }))
        setError(`还有 ${count} 条待处理建议，请先处理后再更改可见性。`)
      } else if (input.visibility === 'public' && isAuthRequiredError(caught)) {
        setStep('details')
        setError(UPLOAD_LOGIN_HINT)
      } else {
        setError('发布失败，请确认后端服务已更新后重试。')
      }
    } finally {
      setLoading(false)
    }
  }

  const pendingVisibility = hasOpenVisibilityChanges(target?.visibility, target?.openContributionCount)
  const sourceSelectDisabled = !personalWordbooks.length || snapshotSourceLocked

  return (
    <div
      className="market-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !loading) onClose()
      }}
    >
      <section
        ref={dialogRef}
        className="market-modal market-publish-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="publish-title"
        tabIndex={-1}
      >
        <button className="modal-close" type="button" aria-label="关闭" onClick={onClose} disabled={loading}>×</button>
        {loading && !personalWordbooks.length ? (
          <p className="publish-loading" role="status">正在读取你的个人词本…</p>
        ) : step === 'details' ? (
          <>
            <p className="marginal">{target ? '更新社区快照' : '新建共享词库'}</p>
            <h2 id="publish-title">{target ? '更新我的上传' : '发布我的词本'}</h2>
            <p>选择词本并填写展示信息。发布的是独立快照，之后修改个人词本不会影响已发布内容。</p>
            <label>
              选择个人词本
              <select
                value={form.sourceWordbookId}
                onChange={(event) => chooseSourceWordbook(event.target.value)}
                disabled={sourceSelectDisabled}
              >
                <option value="">请选择非空词本</option>
                {personalWordbooks.map((book) => (
                  <option key={book.id} value={book.id}>{book.title}（{book.wordCount} 词）</option>
                ))}
              </select>
            </label>
            {target && !form.sourceWordbookId && (
              <p className="publish-source-hint">为避免覆盖错词本，请明确选择这次快照的来源。</p>
            )}
            <label>
              社区展示名称
              <input
                value={form.title}
                maxLength={MARKETPLACE_TITLE_MAX_LENGTH}
                onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                placeholder="例如：7 月阅读积累"
                data-modal-autofocus
              />
              <small>{form.title.trim().length} / {MARKETPLACE_TITLE_MAX_LENGTH}</small>
            </label>
            <label>
              简介
              <textarea
                value={form.description}
                maxLength={240}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                placeholder="告诉大家这本词库适合什么场景。"
              />
            </label>
            <label>
              版本说明
              <input
                value={form.revisionMessage}
                maxLength={80}
                onChange={(event) => setForm((current) => ({ ...current, revisionMessage: event.target.value }))}
                placeholder={target ? '例如：补充 7 月阅读词条' : '首次发布'}
              />
            </label>
            <div className="publish-meta-fields">
              <label>
                考试类型
                <select value={form.exam} onChange={(event) => setForm((current) => ({ ...current, exam: event.target.value }))}>
                  <option value="">不设置</option>
                  {PUBLISH_EXAMS.map((exam) => <option key={exam}>{exam}</option>)}
                </select>
              </label>
              <label>
                学习目标
                <select value={form.goal} onChange={(event) => setForm((current) => ({ ...current, goal: event.target.value }))}>
                  <option value="">不设置</option>
                  {PUBLISH_GOALS.map((goal) => <option key={goal}>{goal}</option>)}
                </select>
              </label>
            </div>
            <fieldset className="publish-visibility">
              <legend>可见性</legend>
              {VISIBILITY_OPTIONS.map((option) => {
                const optionDisabled = (option.value !== 'public' && pendingVisibility) || (option.value === 'public' && !isLoggedIn)
                return (
                  <label key={option.value} className={optionDisabled ? 'is-disabled' : ''}>
                    <input
                      type="radio"
                      name="publish-visibility"
                      value={option.value}
                      checked={form.visibility === option.value}
                      disabled={optionDisabled}
                      onChange={() => setForm((current) => ({ ...current, visibility: option.value }))}
                    />
                    <span>
                      <strong>{option.label}</strong>
                      <small>{option.hint}</small>
                    </span>
                  </label>
                )
              })}
              {pendingVisibility && target && (
                <p className="visibility-hint" role="note">
                  还有 {target.openContributionCount} 条待处理建议，请先处理后再更改可见性。
                  <Link to={`/marketplace/${encodeURIComponent(target.id)}?tab=contributions`}>处理该词本的建议</Link>
                  {' · '}
                  <Link to="/marketplace/contributions">打开协作收件箱</Link>
                </p>
              )}
              {!isLoggedIn && <p className="visibility-hint">{UPLOAD_LOGIN_HINT}</p>}
            </fieldset>
            {error && <p className="publish-error" role="alert">{error}</p>}
            <div className="publish-actions">
              <button className="market-secondary" type="button" onClick={onClose}>取消</button>
              <button className="market-primary" type="button" disabled={!personalWordbooks.length} onClick={openPreview}>预览发布</button>
            </div>
          </>
        ) : (
          <>
            <p className="marginal">发布预览</p>
            <h2 id="publish-title">确认社区快照</h2>
            <div className="publish-preview">
              <BookCover tone="blue" label={(form.exam || form.title.slice(0, 5)).toUpperCase()} />
              <div>
                <strong>{form.title}</strong>
                <span>{selectedSource?.wordCount ?? 0} 词 · {selectedSource?.title}</span>
                <p>{form.description || '暂无简介'}</p>
                <small>{[form.exam, form.goal].filter(Boolean).join(' · ') || '未设置分类'}</small>
                <small>版本说明：{form.revisionMessage || (target ? '更新词书' : '首次发布')}</small>
                <small>可见性：{VISIBILITY_LABELS[form.visibility]}</small>
              </div>
            </div>
            <p>确认后，社区会保存这本词本的当前副本。以后主动更新快照，也不会改动其他用户已加入的词本。</p>
            {error && <p className="publish-error" role="alert">{error}</p>}
            <div className="publish-actions">
              <button className="market-secondary" type="button" disabled={loading} onClick={() => setStep('details')}>返回修改</button>
              <button className="market-primary" type="button" disabled={loading} onClick={() => { void submit() }}>
                {loading ? '正在发布…' : target ? '更新社区快照' : '确认发布'}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
