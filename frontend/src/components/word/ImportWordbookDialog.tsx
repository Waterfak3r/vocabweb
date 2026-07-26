import { useEffect, useMemo, useState } from 'react'
import type { MyWordbook, ImportConflictResolution, ImportDraft, ImportDraftEntry, ImportDraftLine } from '../../data/workspaceApi'
import { MAX_IMPORT_ENTRIES, parseWordbookText, readImportFile, validateImportText, type ParsedImport } from '../../data/wordbookImport'
import { Button } from '../ui/Button'
import styles from './ImportWordbookDialog.module.css'

type ImportDraftApi = {
  createImportDraft: (input: { title: string; description?: string; lines: ImportDraftLine[] }) => Promise<ImportDraft>
  commitImportDraft: (id: string, resolutions?: Record<string, ImportConflictResolution>) => Promise<MyWordbook>
  listImportDrafts: () => Promise<ImportDraft[]>
  getImportDraft: (id: string) => Promise<ImportDraft>
  processImportDraft: (id: string) => Promise<ImportDraft>
  deleteImportDraft: (id: string) => Promise<void>
}

export type ImportWordbookDialogProps = {
  open: boolean
  api: ImportDraftApi | null
  onClose: () => void
  onCreated: (wordbook: MyWordbook) => void
  initialTitle?: string
  initialDescription?: string
}

type Step = 'details' | 'source' | 'preview'
const STEPS: Array<{ id: Step; label: string }> = [
  { id: 'details', label: '基本信息' },
  { id: 'source', label: '输入或文件' },
  { id: 'preview', label: '预览与确认' },
]

const statusLabel: Record<ImportDraftEntry['status'], string> = {
  processing: '匹配中',
  ready: '待导入',
  invalid: '格式无效',
  duplicate: '本次重复',
  unmatched: '未匹配',
  conflict: '词本冲突',
}

function decisionKey(entry: ImportDraftEntry) {
  return entry.id ?? `${entry.line}:${entry.word}`
}

function statusClass(status: ImportDraftEntry['status']) {
  return status === 'processing' ? styles.statusProcessing
    : status === 'ready' ? styles.statusReady
    : status === 'invalid' ? styles.statusInvalid
      : status === 'duplicate' ? styles.statusDuplicate
        : status === 'unmatched' ? styles.statusUnmatched
          : styles.statusConflict
}

export function draftMatchProgress(entries: readonly Pick<ImportDraftEntry, 'status'>[]) {
  const total = entries.length
  const completed = entries.filter((entry) => entry.status !== 'processing').length
  return { total, completed, percent: total ? Math.round((completed / total) * 100) : 0 }
}

/**
 * Shared three-step import window. Pages only own opening it and redirecting
 * after onCreated; all file reading, preview, draft creation and conflict
 * decisions remain here so creation and future community flows stay identical.
 */
export function ImportWordbookDialog({ open, api, onClose, onCreated, initialTitle = '', initialDescription = '' }: ImportWordbookDialogProps) {
  const [step, setStep] = useState<Step>('details')
  const [title, setTitle] = useState(initialTitle)
  const [description, setDescription] = useState(initialDescription)
  const [content, setContent] = useState('')
  const [parsed, setParsed] = useState<ParsedImport | null>(null)
  const [draft, setDraft] = useState<ImportDraft | null>(null)
  const [savedDrafts, setSavedDrafts] = useState<ImportDraft[]>([])
  const [decisions, setDecisions] = useState<Record<string, ImportConflictResolution>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [busy, onClose, open])

  useEffect(() => {
    if (!open || !api) return
    let active = true
    void api.listImportDrafts()
      .then((items) => {
        if (active) setSavedDrafts(items.filter((item) => item.status !== 'committed'))
      })
      .catch(() => {
        if (active) setSavedDrafts([])
      })
    return () => { active = false }
  }, [api, open])

  useEffect(() => {
    if (open) return
    setStep('details'); setContent(''); setParsed(null); setDraft(null); setSavedDrafts([]); setDecisions({}); setError(''); setBusy(false)
    setTitle(initialTitle); setDescription(initialDescription)
  }, [initialDescription, initialTitle, open])

  useEffect(() => {
    if (!open || !api || draft?.status !== 'processing') return

    let cancelled = false
    let timer: number | undefined
    const draftId = draft.id
    const update = (next: ImportDraft) => {
      if (cancelled) return
      setDraft(next)
      setSavedDrafts((current) => current.map((item) => item.id === next.id ? next : item))
    }
    const poll = async (start: boolean) => {
      try {
        const next = start ? await api.processImportDraft(draftId) : await api.getImportDraft(draftId)
        update(next)
        if (!cancelled && next.status === 'processing') timer = window.setTimeout(() => { void poll(false) }, 850)
      } catch {
        if (!cancelled) {
          setError('词典匹配仍在后台进行。你可以关闭窗口，稍后从导入草稿继续。')
          timer = window.setTimeout(() => { void poll(false) }, 1_500)
        }
      }
    }
    void poll(true)
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [api, draft?.id, draft?.status, open])

  const entries = useMemo<ImportDraftEntry[]>(() => {
    if (!draft) return parsed?.entries ?? []
    const rejected = (parsed?.entries ?? []).filter((entry) => entry.status === 'invalid' || entry.status === 'duplicate')
    return [...draft.entries, ...rejected].sort((left, right) => left.line - right.line)
  }, [draft, parsed])
  if (!open) return null

  function nextDetails() {
    if (!title.trim()) { setError('请先填写单词本名称。'); return }
    setError(''); setStep('source')
  }

  async function chooseFile(file: File | undefined) {
    if (!file) return
    setBusy(true); setError('')
    try {
      const imported = await readImportFile(file)
      setContent(imported)
      setParsed(null); setDraft(null); setDecisions({})
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '文件无法读取，请换一个文件重试。')
    } finally { setBusy(false) }
  }

  async function createDraft() {
    const sizeError = validateImportText(content)
    if (sizeError) {
      setError(sizeError)
      return
    }
    const nextParsed = parseWordbookText(content)
    setParsed(nextParsed); setDraft(null); setDecisions({})
    if (nextParsed.acceptedCount === 0) { setError('没有找到可导入的英文单词，请按“一行一个单词”的格式检查。'); return }
    if (!api) { setError('当前未连接词本服务，暂时不能保存导入草稿。'); return }

    setBusy(true); setError('')
    try {
      const nextDraft = await api.createImportDraft({ title: title.trim(), description: description.trim() || undefined, lines: nextParsed.entries.filter((entry) => entry.status === 'ready').map(({ line, word, zhMeaning }) => ({ line, word, zhMeaning })) })
      setDraft(nextDraft)
      setStep('preview')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存导入草稿失败，请重试。')
    } finally { setBusy(false) }
  }

  function setDecision(entry: ImportDraftEntry, decision: ImportConflictResolution) {
    setDecisions((current) => ({ ...current, [decisionKey(entry)]: decision }))
  }

  async function commit() {
    if (!api || !draft) return
    setBusy(true); setError('')
    try {
      const wordbook = await api.commitImportDraft(draft.id, decisions)
      onCreated(wordbook)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '创建单词本失败，请重试。')
    } finally { setBusy(false) }
  }

  function continueDraft(item: ImportDraft) {
    setTitle(item.title)
    setDescription(item.description)
    setDraft(item)
    setParsed(null)
    setDecisions({})
    setError('')
    setStep('preview')
  }

  async function removeDraft(item: ImportDraft) {
    if (!api) return
    setBusy(true)
    try {
      await api.deleteImportDraft(item.id)
      setSavedDrafts((current) => current.filter((draftItem) => draftItem.id !== item.id))
    } catch {
      setError('草稿删除失败，请稍后重试。')
    } finally {
      setBusy(false)
    }
  }

  const readyCount = entries.filter((entry) => entry.status === 'ready').length
  const unmatchedCount = entries.filter((entry) => entry.status === 'unmatched').length
  const conflictCount = entries.filter((entry) => entry.status === 'conflict').length
  const continuationCount = draft?.totalBatches ?? parsed?.batchCount ?? 0
  const isProcessing = draft?.status === 'processing'
  const matchProgress = draftMatchProgress(draft?.entries ?? [])

  return (
    <div className={styles.backdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="wordbook-import-title">
        <header className={styles.header}>
          <h2 className={styles.title} id="wordbook-import-title">{draft?.targetWordbookId ? '继续导入草稿' : '新建单词本'}</h2>
          <button className={styles.close} type="button" aria-label="关闭" disabled={busy} onClick={onClose}>×</button>
        </header>
        <div className={styles.body}>
          <ol className={styles.steps} aria-label="导入步骤">
            {STEPS.map((item) => <li className={`${styles.step} ${item.id === step ? styles.active : ''}`} key={item.id}>{item.label}</li>)}
          </ol>

          {step === 'details' && <>
            <div className={styles.field}>
              <label htmlFor="import-title">词本名称</label>
              <input id="import-title" value={title} maxLength={80} autoFocus onChange={(event) => setTitle(event.target.value)} placeholder="例如：雅思写作高频词" />
            </div>
            <div className={styles.field}>
              <label htmlFor="import-description">说明（可选）</label>
              <input id="import-description" value={description} maxLength={240} onChange={(event) => setDescription(event.target.value)} placeholder="记录这个词本的用途" />
            </div>
            {savedDrafts.length > 0 && <section className={styles.savedDrafts} aria-label="未完成的导入草稿">
              <h3>继续未完成的导入</h3>
              <p className={styles.hint}>超出单批上限的内容会留在这里，继续后会追加到同一本词本。</p>
              <div>
                {savedDrafts.map((item) => <article key={item.id}>
                  <span><strong>{item.title}</strong><small>第 {item.batchIndex}/{item.totalBatches} 批 · {item.status === 'processing' ? '匹配中' : `${item.entries.length} 行`}</small></span>
                  <button type="button" disabled={busy} onClick={() => continueDraft(item)}>{item.status === 'processing' ? '查看进度' : '继续'}</button>
                  <button type="button" disabled={busy} onClick={() => { void removeDraft(item) }}>删除</button>
                </article>)}
              </div>
            </section>}
          </>}

          {step === 'source' && <>
            <div className={styles.field}>
              <label htmlFor="import-content">粘贴单词</label>
              <textarea id="import-content" value={content} onChange={(event) => { setContent(event.target.value); setParsed(null); setDraft(null) }} placeholder={'resilient 有韧性的；能快速恢复的\ncontribute 做贡献'} />
              <span className={styles.hint}>每行“英文单词 中文释义”；中文释义可省略。一次最多导入 {MAX_IMPORT_ENTRIES} 个有效词，更多内容会按批保存为草稿。</span>
            </div>
            <div className={styles.upload}>
              <strong>或选择文件</strong>
              <span className={styles.hint}>支持 TXT、Markdown、DOCX，单个文件不超过 1MB。</span>
              <input type="file" accept=".txt,.md,.markdown,.docx,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document" disabled={busy} onChange={(event) => { void chooseFile(event.target.files?.[0]) }} />
            </div>
          </>}

          {step === 'preview' && isProcessing && <section className={styles.processing} role="status">
            <strong>正在匹配第 {draft?.batchIndex}/{draft?.totalBatches} 批词典数据</strong>
            <p>{matchProgress.completed}/{matchProgress.total} 词已完成匹配。你可以关闭窗口，后台会继续保存进度；稍后从未完成草稿进入即可继续查看。</p>
            <progress value={matchProgress.completed} max={Math.max(1, matchProgress.total)} aria-label="词典匹配进度" />
            <small>{matchProgress.percent}%</small>
          </section>}

          {step === 'preview' && !isProcessing && <>
            <div className={styles.summary}>
              <span className={styles.pill}>待导入 {readyCount} 词</span>
              {unmatchedCount > 0 && <span className={styles.pill}>未匹配 {unmatchedCount} 词</span>}
              {conflictCount > 0 && <span className={styles.pill}>与词本冲突 {conflictCount} 词</span>}
              {continuationCount > 1 && <span className={styles.pill}>将生成 {continuationCount - 1} 个后续草稿</span>}
            </div>
            <p className={styles.hint}>你提供的中文释义会被保留；系统只补全音标、发音和英文释义。返回上一步可改正格式无效或重复的行。</p>
            <table className={styles.table}>
              <thead><tr><th>行</th><th>单词</th><th>中文释义</th><th>状态</th><th>处理</th></tr></thead>
              <tbody>
                {entries.map((entry) => {
                  const key = decisionKey(entry)
                  const decision = decisions[key] ?? entry.resolution
                  return <tr key={key}>
                    <td>{entry.line}</td><td>{entry.word}</td><td>{entry.zhMeaning || '—'}</td>
                    <td><span className={`${styles.status} ${statusClass(entry.status)}`}>{statusLabel[entry.status]}</span>{entry.reason && <div className={styles.muted}>{entry.reason}</div>}</td>
                    <td>
                      {entry.status === 'conflict' && <div className={styles.actions}>
                        {(['keep', 'replace', 'merge'] as const).map((choice) => <button type="button" className={`${styles.choice} ${decision === choice ? styles.choiceActive : ''}`} onClick={() => setDecision(entry, choice)} key={choice}>{choice === 'keep' ? '保留原词' : choice === 'replace' ? '覆盖原词' : '合并释义'}</button>)}
                      </div>}
                      {entry.status === 'unmatched' && <div className={styles.actions}>
                        <button type="button" className={`${styles.choice} ${decision !== 'discard' ? styles.choiceActive : ''}`} onClick={() => setDecision(entry, 'keep')}>保留</button>
                        <button type="button" className={`${styles.choice} ${decision === 'discard' ? styles.choiceActive : ''}`} onClick={() => setDecision(entry, 'discard')}>移除</button>
                      </div>}
                    </td>
                  </tr>
                })}
              </tbody>
            </table>
          </>}
          {error && <p className={styles.error} role="alert">{error}</p>}
        </div>
        <footer className={styles.footer}>
          {step !== 'details' && !isProcessing && <Button variant="secondary" disabled={busy} onClick={() => { setError(''); setStep(step === 'preview' ? 'source' : 'details') }}>上一步</Button>}
          {step === 'details' && <Button disabled={busy} onClick={nextDetails}>下一步</Button>}
          {step === 'source' && <Button disabled={busy} onClick={() => { void createDraft() }}>{busy ? '正在匹配词典…' : '解析并预览'}</Button>}
          {step === 'preview' && !isProcessing && <Button disabled={busy || !draft || draft.status !== 'pending'} onClick={() => { void commit() }}>{busy ? '正在保存…' : draft?.targetWordbookId ? '追加到单词本' : '创建单词本'}</Button>}
        </footer>
      </section>
    </div>
  )
}
