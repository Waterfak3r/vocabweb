import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { CatalogDiff } from '../components/marketplace/CatalogDiff'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import {
  getWorkspaceApi,
  WorkspaceApiError,
  type CatalogContribution,
  type CatalogConflict,
} from '../data/workspaceApi'
import type { WordEntry } from '../domain/types'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

const STATUS: Record<CatalogContribution['status'], string> = {
  open: '待审核',
  merged: '已合并',
  closed: '已关闭',
}

const CONFLICT_REASON_LABELS: Record<CatalogConflict['reason'], string> = {
  'overlapping-change': '公开版本与建议修改重叠',
  'source-diverged': '发布源词本已发生变化',
}

export function conflictReasonLabel(reason: CatalogConflict['reason']): string {
  return CONFLICT_REASON_LABELS[reason]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseConflictEntry(value: unknown): WordEntry | undefined | null {
  if (value === undefined) return undefined
  if (!isRecord(value) || typeof value.word !== 'string' || typeof value.phonetic !== 'string' || typeof value.source !== 'string' || !Array.isArray(value.meanings)) return null
  if (!['backend', 'dictionary-api', 'local-ielts', 'user'].includes(value.source)) return null
  const meanings = value.meanings.map((meaning) => {
    if (!isRecord(meaning) || typeof meaning.pos !== 'string' || typeof meaning.definition !== 'string' || (meaning.example !== undefined && typeof meaning.example !== 'string')) return null
    return { pos: meaning.pos, definition: meaning.definition, example: meaning.example }
  })
  if (meanings.some((meaning) => meaning === null)) return null
  if (value.audioUrl !== undefined && typeof value.audioUrl !== 'string') return null
  if (value.zhMeaning !== undefined && typeof value.zhMeaning !== 'string') return null
  if (value.zhMeaningSource !== undefined && value.zhMeaningSource !== 'user' && value.zhMeaningSource !== 'dictionary') return null
  return {
    word: value.word,
    phonetic: value.phonetic,
    source: value.source as WordEntry['source'],
    meanings: meanings as WordEntry['meanings'],
    audioUrl: value.audioUrl,
    zhMeaning: value.zhMeaning,
    zhMeaningSource: value.zhMeaningSource,
  }
}

/** Safely reads conflict details from a failed merge without weakening API parsing. */
export function parseContributionConflicts(error: unknown): CatalogConflict[] {
  if (!isRecord(error) || !isRecord(error.details) || !Array.isArray(error.details.conflicts)) return []
  return error.details.conflicts.flatMap((value): CatalogConflict[] => {
    if (!isRecord(value) || typeof value.key !== 'string' || (value.reason !== 'overlapping-change' && value.reason !== 'source-diverged')) return []
    const base = parseConflictEntry(value.base)
    const current = parseConflictEntry(value.current)
    const proposed = parseConflictEntry(value.proposed)
    if ((value.base !== undefined && !base) || (value.current !== undefined && !current) || (value.proposed !== undefined && !proposed)) return []
    return [{
      key: value.key,
      reason: value.reason,
      base: base ?? undefined,
      current: current ?? undefined,
      proposed: proposed ?? undefined,
    }]
  })
}

export function conflictEntrySummary(entry: WordEntry | undefined): string {
  if (!entry) return '词条不存在'
  const meaning = entry.meanings[0]
  return [entry.word, entry.zhMeaning, meaning?.definition].filter(Boolean).join(' · ') || entry.word
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
  const [conflicts, setConflicts] = useState<CatalogConflict[]>([])
  const loadRequestRef = useRef(0)
  useDocumentTitle(contribution ? `${contribution.title} · 改进建议` : '改进建议')

  const loadContribution = useCallback(async () => {
    const request = ++loadRequestRef.current
    if (!api || !id || !contributionId) {
      setLoading(false)
      setError('无法读取这条改进建议。')
      return
    }
    setLoading(true)
    try {
      const result = await api.getCatalogContribution(id, contributionId)
      if (request !== loadRequestRef.current) return
      setContribution(result)
      setConflicts([])
      setError('')
    } catch {
      if (request !== loadRequestRef.current) return
      setError('建议不存在、不可见或暂时无法加载。')
    } finally {
      if (request === loadRequestRef.current) setLoading(false)
    }
  }, [api, contributionId, id])

  useEffect(() => { void loadContribution() }, [loadContribution])

  async function merge() {
    if (!api || !contribution || submitting) return
    setSubmitting(true)
    setError('')
    setConflicts([])
    try {
      setContribution(await api.mergeContribution(id, contribution.id, {
        resolutionNote: resolutionNote.trim(),
      }))
    } catch (caught) {
      setConflicts(parseContributionConflicts(caught))
      setError(actionError(caught))
    } finally {
      setSubmitting(false)
    }
  }

  async function close() {
    if (!api || !contribution || submitting) return
    setSubmitting(true)
    setError('')
    setConflicts([])
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

      {conflicts.length > 0 && (
        <section className="collab-conflicts" aria-labelledby="contribution-conflicts-title">
          <header>
            <div><p className="marginal">合并未写入</p><h2 id="contribution-conflicts-title">请处理 {conflicts.length} 个冲突词条</h2></div>
            <Button variant="secondary" disabled={loading || submitting} onClick={() => void loadContribution()}>重新读取建议</Button>
          </header>
          <p>请先在发布源词本处理这些词条并更新社区快照；如果建议基线已经过期，请让贡献者从最新副本重新提交。</p>
          <ul className="collab-conflict-list">
            {conflicts.map((conflict, index) => <li key={`${conflict.key}:${index}`}>
              <header><strong>{conflict.key}</strong><small>{conflict.current?.word ?? conflict.proposed?.word ?? '无词条内容'}</small></header>
              <p>原因：{conflictReasonLabel(conflict.reason)}</p>
              <div className="collab-conflict-compare">
                <span><b>当前</b>{conflictEntrySummary(conflict.current)}</span>
                <span><b>建议</b>{conflictEntrySummary(conflict.proposed)}</span>
              </div>
            </li>)}
          </ul>
        </section>
      )}

      {contribution.status === 'open' && (contribution.canMerge || contribution.canClose) && (
        <section className="collab-review-actions" aria-labelledby="review-actions-title">
          <div>
            <h2 id="review-actions-title">{contribution.canMerge ? '审核此建议' : '管理我的建议'}</h2>
            <p>{contribution.canMerge ? '合并会原子更新公开词书和你的发布源词书，并创建一个新版本。删除的词条会从源词本移除，历史学习记录保留；进行中的该词本学习轮次会结束，需重新开始。' : '撤回后建议将关闭，历史差异仍可查看。'}</p>
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
