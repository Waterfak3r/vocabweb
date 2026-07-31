import { useEffect, useMemo, useState } from 'react'
import type { MyWordbook, ImportConflictResolution, ImportDraft, ImportDraftEntry, ImportDraftLine } from '../../data/workspaceApi'
import { MAX_IMPORT_ENTRIES, parseWordbookText, readImportFile, validateImportText, type ParsedImport } from '../../data/wordbookImport'
import { Button } from '../ui/Button'
import styles from './ImportWordbookDialog.module.css'

type ImportDraftApi = {
  createImportDraft: (input: { title: string; description?: string; targetWordbookId?: string; lines: ImportDraftLine[] }) => Promise<ImportDraft>
  commitImportDraft: (id: string, resolutions?: Record<string, ImportConflictResolution>, mode?: 'append' | 'overwrite') => Promise<MyWordbook>
  listImportDrafts: () => Promise<ImportDraft[]>
  getImportDraft: (id: string) => Promise<ImportDraft>
  processImportDraft: (id: string) => Promise<ImportDraft>
  deleteImportDraft: (id: string) => Promise<void>
  updateMyWordbook: (id: string, input: { category: string | null }) => Promise<MyWordbook>
}

export type ImportWordbookDialogProps = {
  open: boolean
  api: ImportDraftApi | null
  onClose: () => void
  onCreated: (wordbook: MyWordbook) => void
  initialTitle?: string
  initialDescription?: string
  initialCategory?: string
  targetWordbookId?: string
  targetWords?: string[]
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

export function nextImportDraft(drafts: readonly ImportDraft[], current: Pick<ImportDraft, 'id' | 'groupId'>) {
  return drafts
    .filter((item) => item.groupId === current.groupId && item.status !== 'committed' && item.id !== current.id)
    .sort((left, right) => left.batchIndex - right.batchIndex)[0]
}

/**
 * Shared three-step import window. Pages only own opening it and redirecting
 * after onCreated; all file reading, preview, draft creation and conflict
 * decisions remain here so creation and future community flows stay identical.
 */
export function ImportWordbookDialog({ open, api, onClose, onCreated, initialTitle = '', initialDescription = '', initialCategory = '', targetWordbookId, targetWords = [] }: ImportWordbookDialogProps) {
  const [step, setStep] = useState<Step>(targetWordbookId ? 'source' : 'details')
  const [title, setTitle] = useState(initialTitle)
  const [description, setDescription] = useState(initialDescription)
  const [category, setCategory] = useState(initialCategory)
  const [content, setContent] = useState('')
  const [parsed, setParsed] = useState<ParsedImport | null>(null)
  const [draft, setDraft] = useState<ImportDraft | null>(null)
  const [savedDrafts, setSavedDrafts] = useState<ImportDraft[]>([])
  const [decisions, setDecisions] = useState<Record<string, ImportConflictResolution>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [commitMode, setCommitMode] = useState<'append' | 'overwrite'>('append')
  const [overwriteImpact, setOverwriteImpact] = useState<{ imported: number; removed: number } | null>(null)

  useEffect(() => {
    if (!open) return
    setTitle(initialTitle)
    setDescription(initialDescription)
    setCategory(initialCategory)
    setStep(targetWordbookId ? 'source' : 'details')
  }, [initialCategory, initialDescription, initialTitle, open, targetWordbookId])

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
    setStep(targetWordbookId ? 'source' : 'details'); setContent(''); setParsed(null); setDraft(null); setSavedDrafts([]); setDecisions({}); setError(''); setBusy(false); setCommitMode('append'); setOverwriteImpact(null)
    setTitle(initialTitle); setDescription(initialDescription); setCategory(initialCategory)
  }, [initialCategory, initialDescription, initialTitle, open, targetWordbookId])

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
    if (nextParsed.acceptedCount === 0) { setError('没有找到可导入的英文词条，请确认每行首列填写了合法的英文单词或词组。'); return }
    if (!api) { setError('当前未连接词本服务，暂时不能保存导入草稿。'); return }

    setBusy(true); setError('')
    try {
      const nextDraft = await api.createImportDraft({
        title: title.trim(), description: description.trim() || undefined,
        ...(targetWordbookId ? { targetWordbookId } : {}),
        lines: nextParsed.entries.filter((entry) => entry.status === 'ready').map(({ line, word, phonetic, pos, enDefinition, zhMeaning, example, meanings }) => ({
          line, word, ...(pos ? { pos } : {}), ...(enDefinition ? { enDefinition } : {}),
          ...(phonetic ? { phonetic } : {}), ...(zhMeaning ? { zhMeaning } : {}), ...(example ? { example } : {}),
          ...(meanings ? { meanings } : {}),
        })),
      })
      setDraft(nextDraft)
      setStep('preview')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存导入草稿失败，请重试。')
    } finally { setBusy(false) }
  }

  function setDecision(entry: ImportDraftEntry, decision: ImportConflictResolution) {
    setDecisions((current) => ({ ...current, [decisionKey(entry)]: decision }))
  }

  async function commit(mode: 'append' | 'overwrite' = commitMode) {
    if (!api || !draft) return
    setBusy(true); setError('')
    try {
      let wordbook = await api.commitImportDraft(draft.id, decisions, mode)
      if (!targetWordbookId && category.trim()) {
        wordbook = await api.updateMyWordbook(wordbook.id, { category: category.trim() })
      }
      if (mode === 'overwrite') {
        onCreated(wordbook)
        onClose()
        return
      }
      const group = await api.listImportDrafts()
      const next = nextImportDraft(group, draft)
      if (next) {
        setDraft(next)
        setSavedDrafts(group.filter((item) => item.status !== 'committed'))
        setParsed(null)
        setDecisions({})
        setStep('preview')
      } else {
        onCreated(wordbook)
        onClose()
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '创建单词本失败，请重试。')
    } finally { setBusy(false) }
  }

  async function requestCommit() {
    if (!api || !draft || commitMode === 'append') {
      await commit('append')
      return
    }
    setBusy(true); setError('')
    try {
      const drafts = await api.listImportDrafts()
      const group = drafts.filter((item) => item.groupId === draft.groupId)
      if (group.length !== draft.totalBatches) {
        setError('部分导入批次已经缺失，不能执行整体覆盖；请重新解析源文件。')
        return
      }
      if (group.some((item) => item.status === 'processing')) {
        setError('整批内容仍在匹配词典，请稍候再确认覆盖。')
        return
      }
      const accepted = group.flatMap((item) => item.entries)
        .filter((entry) => entry.status === 'ready' || entry.status === 'unmatched' || entry.status === 'conflict')
      const importedWords = new Set(accepted.map((entry) => entry.word))
      const retained = new Set(targetWords.map((word) => word.trim().toLowerCase()).filter((word) => importedWords.has(word)))
      setOverwriteImpact({ imported: importedWords.size, removed: Math.max(0, targetWords.length - retained.size) })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法核对整批覆盖范围，请重试。')
    } finally {
      setBusy(false)
    }
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
          <h2 className={styles.title} id="wordbook-import-title">{targetWordbookId || draft?.targetWordbookId ? '导入到单词本' : '新建单词本'}</h2>
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
            <div className={styles.field}>
              <label htmlFor="import-category">分类（可选）</label>
              <input id="import-category" value={category} maxLength={30} onChange={(event) => setCategory(event.target.value)} placeholder="例如：考试、写作、生词" />
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
              <label htmlFor="import-content">粘贴单词或 CSV</label>
              <textarea id="import-content" value={content} onChange={(event) => { setContent(event.target.value); setParsed(null); setDraft(null) }} placeholder={'a lot of,phrase,a large amount,许多,We had a lot of time.\nresilient,adjective,,有韧性的'} />
              <span className={styles.hint}>
                一行对应一个单词，以 , 作为分隔符，依次为：词条, 词性, 英文释义, 中文释义, 例句（只有词条为必填项）。字段内含逗号时请用双引号包裹。
                <br />
                e.g. act,(v),(description),(中文意思),(例句)
                <br />
                从单词本导出的六列 CSV 支持多条释义，空白单词行会接续上一词条。
                <br />
                Tip：你可以将这个规则和示例复制给 DeepSeek，让它帮忙处理完你的单词表再导入。
              </span>
            </div>
            <div className={styles.upload}>
              <strong>或选择文件导入</strong>
              <span className={styles.hint}>支持 CSV、TXT、Markdown、DOCX，单个文件不超过 1MB。</span>
              <input type="file" accept=".csv,.txt,.md,.markdown,.docx,text/csv,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document" disabled={busy} onChange={(event) => { void chooseFile(event.target.files?.[0]) }} />
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
            <p className={styles.hint}>你填写的词性、释义和例句优先，空缺字段由词典补齐；词性会优先匹配对应义项。返回上一步可改正词条格式无效或重复的行。</p>
            {draft?.targetWordbookId && <fieldset className={styles.commitMode}>
              <legend>写入方式</legend>
              <label className={commitMode === 'append' ? styles.modeActive : ''}>
                <input type="radio" name="import-mode" checked={commitMode === 'append'} onChange={() => setCommitMode('append')} />
                <span><strong>追加到单词本</strong><small>保留原词条，并处理重复词条冲突。</small></span>
              </label>
              <label className={`${styles.overwriteMode} ${commitMode === 'overwrite' ? styles.modeActive : ''}`}>
                <input type="radio" name="import-mode" checked={commitMode === 'overwrite'} onChange={() => setCommitMode('overwrite')} />
                <span><strong><span aria-hidden="true">⚠</span> 覆盖原单词本</strong><small>本次有效内容将成为词本的完整内容；同词条保留学习进度。</small></span>
              </label>
            </fieldset>}
            <table className={styles.table}>
              <thead><tr><th>行</th><th>词条</th><th>词性 / 英文释义 / 例句</th><th>中文释义</th><th>状态</th><th>处理</th></tr></thead>
              <tbody>
                {entries.map((entry) => {
                  const key = decisionKey(entry)
                  const decision = decisions[key] ?? entry.resolution
                  return <tr key={key}>
                    <td>{entry.line}</td><td>{entry.word}</td>
                    <td>
                      <strong>{entry.pos || entry.entry?.meanings[0]?.pos || '—'}</strong>
                      {(entry.enDefinition || entry.entry?.meanings[0]?.definition) && <div>{entry.enDefinition || entry.entry?.meanings[0]?.definition}</div>}
                      {(entry.example || entry.entry?.meanings[0]?.example) && <div className={styles.muted}>{entry.example || entry.entry?.meanings[0]?.example}</div>}
                    </td>
                    <td>{entry.zhMeaning || entry.entry?.zhMeaning || '—'}</td>
                    <td><span className={`${styles.status} ${statusClass(entry.status)}`}>{statusLabel[entry.status]}</span>{entry.reason && <div className={styles.muted}>{entry.reason}</div>}</td>
                    <td>
                      {commitMode === 'append' && entry.status === 'conflict' && <div className={styles.actions}>
                        {(['keep', 'replace', 'merge'] as const).map((choice) => <button type="button" className={`${styles.choice} ${decision === choice ? styles.choiceActive : ''}`} onClick={() => setDecision(entry, choice)} key={choice}>{choice === 'keep' ? '保留原词' : choice === 'replace' ? '覆盖原词' : '合并释义'}</button>)}
                      </div>}
                      {commitMode === 'append' && entry.status === 'unmatched' && <div className={styles.actions}>
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
          {step === 'preview' && !isProcessing && <Button disabled={busy || !draft || draft.status !== 'pending'} onClick={() => { void requestCommit() }}>{busy ? '正在保存…' : draft?.targetWordbookId ? commitMode === 'overwrite' ? '确认覆盖范围' : '追加到单词本' : '创建单词本'}</Button>}
        </footer>
      </section>
      {overwriteImpact && <div className={styles.confirmBackdrop} role="presentation">
        <section className={styles.confirmDialog} role="alertdialog" aria-modal="true" aria-labelledby="overwrite-confirm-title" aria-describedby="overwrite-confirm-body">
          <span className={styles.dangerIcon} aria-hidden="true">⚠</span>
          <h3 id="overwrite-confirm-title">确定覆盖原单词本？</h3>
          <p id="overwrite-confirm-body">原词本共 {targetWords.length} 词，本次将写入 {overwriteImpact.imported} 个有效词条，并移除约 {overwriteImpact.removed} 个未保留词条。同名词条会沿用原学习进度。</p>
          <p className={styles.dangerText}>此操作无法恢复，也不会自动更新已发布到单词广场的快照。</p>
          <div><Button variant="secondary" autoFocus disabled={busy} onClick={() => setOverwriteImpact(null)}>取消</Button><Button variant="danger" disabled={busy} onClick={() => { setOverwriteImpact(null); void commit('overwrite') }}>{busy ? '正在覆盖…' : '确认覆盖'}</Button></div>
        </section>
      </div>}
    </div>
  )
}
