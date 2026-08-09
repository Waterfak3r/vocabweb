import { useEffect, useMemo, useRef, useState } from 'react'
import type { MyWordbook, ImportConflictResolution, ImportDraft, ImportDraftEntry, ImportDraftLine } from '../../data/workspaceApi'
import { MAX_IMPORT_ENTRIES, MAX_IMPORT_TOTAL_ENTRIES, parseWordbookText, readImportFile, validateImportEntryCount, validateImportText, type ParsedImport } from '../../data/wordbookImport'
import { useModalDialog } from '../../hooks/useModalDialog'
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
  initialDraftId?: string
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
  duplicate: '文件内重复',
  unmatched: '未匹配',
  conflict: '词本冲突',
}

const PROBLEM_PAGE_SIZE = 100

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

export function draftMatchProgress(entries: readonly Pick<ImportDraftEntry, 'status' | 'entry'>[]) {
  const total = entries.length
  const completed = entries.filter((entry) => entry.status !== 'processing'
    && ((entry.status !== 'conflict' && entry.status !== 'duplicate') || Boolean(entry.entry))).length
  return { total, completed, percent: total ? Math.round((completed / total) * 100) : 0 }
}

function draftGroupKey(draft: Pick<ImportDraft, 'id' | 'groupId'>) {
  return draft.groupId ?? draft.id
}

export function importDraftGroup(drafts: readonly ImportDraft[], current: Pick<ImportDraft, 'id' | 'groupId'>) {
  const key = draftGroupKey(current)
  return drafts
    .filter((item) => draftGroupKey(item) === key)
    .sort((left, right) => left.batchIndex - right.batchIndex)
}

export function groupProcessingState(group: readonly Pick<ImportDraft, 'status' | 'queued'>[]): 'queued' | 'processing' | 'pending' {
  if (group.some((item) => item.status === 'processing' && !item.queued)) return 'processing'
  if (group.some((item) => item.queued)) return 'queued'
  return 'pending'
}

export function importProblemEntries(entries: readonly ImportDraftEntry[]) {
  return entries.filter((entry) => entry.status === 'invalid' || entry.status === 'duplicate' || entry.status === 'unmatched' || entry.status === 'conflict')
}

export type ImportCommitOutcome = {
  wordbook: MyWordbook
  categorySaved: boolean
}

type ImportCommitCallbacks = {
  api: Pick<ImportDraftApi, 'commitImportDraft' | 'updateMyWordbook'>
  draftId: string
  decisions: Record<string, ImportConflictResolution>
  mode: 'append' | 'overwrite'
  category: string
  targetWordbookId?: string
  onCreated: (wordbook: MyWordbook) => void
  onClose: () => void
  onPartial: (wordbook: MyWordbook) => void
}

/** Commits once, preserving a successful wordbook when its optional category write fails. */
export async function commitImportedDraft({ api, draftId, decisions, mode, category, targetWordbookId, onCreated, onClose, onPartial }: ImportCommitCallbacks): Promise<ImportCommitOutcome> {
  const committed = await api.commitImportDraft(draftId, decisions, mode)
  let wordbook = committed
  let categorySaved = true
  if (!targetWordbookId && category.trim()) {
    try {
      wordbook = await api.updateMyWordbook(committed.id, { category: category.trim() })
    } catch {
      categorySaved = false
    }
  }
  onCreated(wordbook)
  if (categorySaved) onClose()
  else onPartial(wordbook)
  return { wordbook, categorySaved }
}

/**
 * Shared three-step import window. Pages only own opening it and redirecting
 * after onCreated; all file reading, preview, draft creation and conflict
 * decisions remain here so creation and future community flows stay identical.
 */
export function ImportWordbookDialog({ open, api, onClose, onCreated, initialTitle = '', initialDescription = '', initialCategory = '', initialDraftId, targetWordbookId, targetWords = [] }: ImportWordbookDialogProps) {
  const [step, setStep] = useState<Step>(targetWordbookId ? 'source' : 'details')
  const [title, setTitle] = useState(initialTitle)
  const [description, setDescription] = useState(initialDescription)
  const [category, setCategory] = useState(initialCategory)
  const [content, setContent] = useState('')
  const [parsed, setParsed] = useState<ParsedImport | null>(null)
  const [draft, setDraft] = useState<ImportDraft | null>(null)
  const [groupDrafts, setGroupDrafts] = useState<ImportDraft[]>([])
  const [savedDrafts, setSavedDrafts] = useState<ImportDraft[]>([])
  const [decisions, setDecisions] = useState<Record<string, ImportConflictResolution>>({})
  const [problemPage, setProblemPage] = useState(1)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [creatingDraft, setCreatingDraft] = useState(false)
  const [commitMode, setCommitMode] = useState<'append' | 'overwrite'>('append')
  const [overwriteImpact, setOverwriteImpact] = useState<{ imported: number; removed: number } | null>(null)
  const [partialCompletion, setPartialCompletion] = useState(false)
  const [createdWordbook, setCreatedWordbook] = useState<MyWordbook | null>(null)
  const commitInFlightRef = useRef(false)
  const dialogRef = useModalDialog<HTMLElement>({ open, onClose, canClose: !busy })
  const wasOpen = useRef(false)

  useEffect(() => {
    const justOpened = open && !wasOpen.current
    wasOpen.current = open
    if (!justOpened) return
    setTitle(initialTitle)
    setDescription(initialDescription)
    setCategory(initialCategory)
    setStep(targetWordbookId ? 'source' : 'details')
    setPartialCompletion(false)
    setCreatedWordbook(null)
    commitInFlightRef.current = false
  }, [initialCategory, initialDescription, initialTitle, open, targetWordbookId])

  useEffect(() => {
    if (!open || !api) return
    let active = true
    void api.listImportDrafts()
      .then((items) => {
        if (!active) return
        setSavedDrafts(items.filter((item) => item.status !== 'committed'))
        if (!initialDraftId) return
        const requested = items.find((item) => item.id === initialDraftId && item.status !== 'committed')
        if (requested) continueDraft(requested)
        else setError('该导入任务已经完成、已删除或不属于当前账号。')
      })
      .catch(() => {
        if (active) setSavedDrafts([])
      })
    return () => { active = false }
  }, [api, initialDraftId, open])

  useEffect(() => {
    if (open) return
    setStep(targetWordbookId ? 'source' : 'details'); setContent(''); setParsed(null); setDraft(null); setGroupDrafts([]); setSavedDrafts([]); setDecisions({}); setProblemPage(1); setError(''); setBusy(false); setCreatingDraft(false); setCommitMode('append'); setOverwriteImpact(null); setPartialCompletion(false); setCreatedWordbook(null); commitInFlightRef.current = false
    setTitle(initialTitle); setDescription(initialDescription); setCategory(initialCategory)
  }, [initialCategory, initialDescription, initialTitle, open, targetWordbookId])

  useEffect(() => {
    if (!open || !api || !draft) return

    let cancelled = false
    let timer: number | undefined
    const anchorId = draft.id
    const schedule = (action: () => void, delay: number) => {
      if (!cancelled) timer = window.setTimeout(action, delay)
    }
    const update = (next: ImportDraft) => {
      if (cancelled) return
      if (next.id === anchorId) setDraft(next)
      setGroupDrafts((current) => {
        const remaining = current.filter((item) => item.id !== next.id)
        return [...remaining, next].sort((left, right) => left.batchIndex - right.batchIndex)
      })
      setSavedDrafts((current) => current.map((item) => item.id === next.id ? next : item))
    }
    const loadGroup = async () => {
      try {
        const items = await api.listImportDrafts()
        if (cancelled) return
        const group = importDraftGroup(items, draft)
        setGroupDrafts(group)
        setSavedDrafts(items.filter((item) => item.status !== 'committed'))
        if (group.length !== draft.totalBatches) {
          setError('部分导入批次已经缺失，请删除该组草稿并重新解析源文件。')
          return
        }
        const nextBatch = group.find((item) => item.status === 'processing')
        if (!nextBatch) {
          setError('')
          return
        }
        let started: ImportDraft
        try {
          started = await api.processImportDraft(nextBatch.id)
          update(started)
        } catch {
          setError('词典匹配队列暂时繁忙，草稿已经保存，正在等待自动重试。')
          schedule(() => { void loadGroup() }, 5_000)
          return
        }
        if (started.status !== 'processing') {
          schedule(() => { void loadGroup() }, 0)
          return
        }
        // The next listImportDrafts poll already returns the batch's newest
        // state, so a separate getImportDraft would only double the payload.
        schedule(() => { void loadGroup() }, 5_000)
      } catch {
        if (!cancelled) {
          setError('暂时无法读取整组导入进度。草稿已经保存，正在自动重试。')
          schedule(() => { void loadGroup() }, 5_000)
        }
      }
    }
    void loadGroup()
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [api, draft?.id, open])

  const entries = useMemo<ImportDraftEntry[]>(() => {
    if (!draft) return parsed?.entries ?? []
    const drafts = groupDrafts.length ? groupDrafts : [draft]
    return drafts.flatMap((item) => item.entries).sort((left, right) => left.line - right.line)
  }, [draft, groupDrafts, parsed])
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
      setParsed(null); setDraft(null); setGroupDrafts([]); setDecisions({}); setProblemPage(1)
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
    setParsed(nextParsed); setDraft(null); setGroupDrafts([]); setDecisions({}); setProblemPage(1)
    if (nextParsed.acceptedCount === 0) { setError('没有找到可导入的英文词条，请确认每行首列填写了合法的英文单词或词组。'); return }
    const entryCountError = validateImportEntryCount(nextParsed.entries.length)
    if (entryCountError) { setError(entryCountError); return }
    if (!api) { setError('当前未连接词本服务，暂时不能保存导入草稿。'); return }

    setBusy(true); setCreatingDraft(true); setError(''); setStep('preview')
    try {
      const nextDraft = await api.createImportDraft({
        title: title.trim(), description: description.trim() || undefined,
        ...(targetWordbookId ? { targetWordbookId } : {}),
        lines: nextParsed.entries.map(({ line, word, phonetic, pos, enDefinition, zhMeaning, example, meanings, reason }) => ({
          line, word, ...(reason ? { sourceReason: reason } : {}), ...(pos ? { pos } : {}), ...(enDefinition ? { enDefinition } : {}),
          ...(phonetic ? { phonetic } : {}), ...(zhMeaning ? { zhMeaning } : {}), ...(example ? { example } : {}),
          ...(meanings ? { meanings } : {}),
        })),
      })
      setDraft(nextDraft)
      setGroupDrafts([nextDraft])
      setStep('preview')
    } catch (cause) {
      setStep('source')
      setError(cause instanceof Error ? cause.message : '保存导入草稿失败，请重试。')
    } finally { setBusy(false); setCreatingDraft(false) }
  }

  function setDecision(entry: ImportDraftEntry, decision: ImportConflictResolution) {
    setDecisions((current) => ({ ...current, [decisionKey(entry)]: decision }))
  }

  function setBulkDecision(status: ImportDraftEntry['status'], decision: ImportConflictResolution) {
    setDecisions((current) => {
      const next = { ...current }
      for (const entry of entries) if (entry.status === status) next[decisionKey(entry)] = decision
      return next
    })
  }

  async function commit(mode: 'append' | 'overwrite' = commitMode) {
    if (!api || !draft || partialCompletion || commitInFlightRef.current) return
    commitInFlightRef.current = true
    setBusy(true); setError('')
    try {
      await commitImportedDraft({
        api,
        draftId: draft.id,
        decisions,
        mode,
        category,
        targetWordbookId,
        onCreated,
        onClose,
        onPartial: (wordbook) => {
          setCreatedWordbook(wordbook)
          setPartialCompletion(true)
        },
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '创建单词本失败，请重试。')
    } finally {
      commitInFlightRef.current = false
      setBusy(false)
    }
  }

  async function requestCommit() {
    if (partialCompletion || commitInFlightRef.current) return
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
        .filter((entry) => (entry.status === 'ready' || entry.status === 'unmatched' || entry.status === 'conflict' || entry.status === 'duplicate')
          && decisions[decisionKey(entry)] !== 'discard')
      const importedWords = new Set(accepted.map((entry) => entry.word).filter(Boolean))
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
    setGroupDrafts([item])
    setParsed(null)
    setDecisions({})
    setProblemPage(1)
    setError('')
    setStep('preview')
  }

  async function removeDraft(item: ImportDraft) {
    if (!api) return
    setBusy(true)
    try {
      const drafts = await api.listImportDrafts()
      const group = importDraftGroup(drafts, item)
      await Promise.all(group.map((draftItem) => api.deleteImportDraft(draftItem.id)))
      const removed = new Set(group.map((draftItem) => draftItem.id))
      setSavedDrafts((current) => current.filter((draftItem) => !removed.has(draftItem.id)))
    } catch {
      setError('草稿删除失败，请稍后重试。')
    } finally {
      setBusy(false)
    }
  }

  const readyCount = entries.filter((entry) => entry.status === 'ready').length
  const invalidCount = entries.filter((entry) => entry.status === 'invalid').length
  const duplicateCount = entries.filter((entry) => entry.status === 'duplicate').length
  const unmatchedCount = entries.filter((entry) => entry.status === 'unmatched').length
  const conflictCount = entries.filter((entry) => entry.status === 'conflict').length
  const continuationCount = draft?.totalBatches ?? parsed?.batchCount ?? 0
  const isProcessing = creatingDraft || (Boolean(draft) && (groupDrafts.length !== draft?.totalBatches || groupDrafts.some((item) => item.status === 'processing')))
  const processingState = groupProcessingState(groupDrafts)
  const queued = !creatingDraft && processingState === 'queued'
  const matchProgress = draftMatchProgress(entries)
  const problems = importProblemEntries(entries)
  const problemPages = Math.max(1, Math.ceil(problems.length / PROBLEM_PAGE_SIZE))
  const visibleProblems = problems.slice((problemPage - 1) * PROBLEM_PAGE_SIZE, problemPage * PROBLEM_PAGE_SIZE)
  const savedDraftGroups = useMemo(() => {
    const seen = new Set<string>()
    return savedDrafts.flatMap((item) => {
      const key = draftGroupKey(item)
      if (seen.has(key)) return []
      seen.add(key)
      const group = importDraftGroup(savedDrafts, item)
      return [{ item: group.find((draftItem) => draftItem.status !== 'committed') ?? item, group }]
    })
  }, [savedDrafts])
  if (!open) return null

  return (
    <div className={styles.backdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <section ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="wordbook-import-title" tabIndex={-1}>
        <header className={styles.header}>
          <h2 className={styles.title} id="wordbook-import-title">{targetWordbookId || draft?.targetWordbookId ? '导入到单词本' : '新建单词本'}</h2>
          <button className={styles.close} type="button" aria-label="关闭" disabled={busy} onClick={onClose}>×</button>
        </header>
        <div className={styles.body}>
          <ol className={styles.steps} aria-label="导入步骤">
            {STEPS.map((item) => <li className={`${styles.step} ${item.id === step ? styles.active : ''}`} key={item.id}>{item.label}</li>)}
          </ol>

          {partialCompletion ? <section className={styles.partialSuccess} role="status" aria-labelledby="import-partial-title">
            <strong id="import-partial-title">词条已导入</strong>
            <p>词条已导入，但分类保存失败；可稍后在词本设置中补充</p>
            {createdWordbook && <small>已创建「{createdWordbook.title}」，导入内容已经保留。</small>}
          </section> : <>
          {step === 'details' && <>
            <div className={styles.field}>
              <label htmlFor="import-title">词本名称</label>
              <input id="import-title" value={title} maxLength={80} data-modal-autofocus onChange={(event) => setTitle(event.target.value)} placeholder="例如：雅思写作高频词" />
            </div>
            <div className={styles.field}>
              <label htmlFor="import-description">说明（可选）</label>
              <input id="import-description" value={description} maxLength={240} onChange={(event) => setDescription(event.target.value)} placeholder="记录这个词本的用途" />
            </div>
            <div className={styles.field}>
              <label htmlFor="import-category">分类（可选）</label>
              <input id="import-category" value={category} maxLength={30} onChange={(event) => setCategory(event.target.value)} placeholder="例如：考试、写作、生词" />
            </div>
            {savedDraftGroups.length > 0 && <section className={styles.savedDrafts} aria-label="未完成的导入草稿">
              <h3>继续未完成的导入</h3>
              <p className={styles.hint}>每次导入只保留一个整组草稿入口；继续后会自动处理剩余批次并统一汇总问题。</p>
              <div>
                {savedDraftGroups.map(({ item, group }) => <article key={draftGroupKey(item)}>
                  <span><strong>{item.title}</strong><small>共 {item.totalBatches} 批 · {groupProcessingState(group) === 'queued' ? '排队中' : groupProcessingState(group) === 'processing' ? '后台处理中' : '等待统一确认'}</small></span>
                  <button type="button" disabled={busy} onClick={() => continueDraft(item)}>{groupProcessingState(group) === 'pending' ? '继续处理' : '查看进度'}</button>
                  <button type="button" disabled={busy} onClick={() => { void removeDraft(item) }}>删除</button>
                </article>)}
              </div>
            </section>}
          </>}

          {step === 'source' && <>
            <div className={styles.field}>
              <label htmlFor="import-content">粘贴单词或 CSV</label>
              <textarea id="import-content" value={content} onChange={(event) => { setContent(event.target.value); setParsed(null); setDraft(null); setGroupDrafts([]); setProblemPage(1) }} placeholder={'a lot of,phrase,a large amount,许多,We had a lot of time.\nresilient,adjective,,有韧性的'} />
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
              <span className={styles.hint}>支持 CSV、TXT、Markdown、DOCX，单个文件不超过 1MB。超过 {MAX_IMPORT_ENTRIES} 词会自动拆批排队，单次最多 {MAX_IMPORT_TOTAL_ENTRIES.toLocaleString('en-US')} 词。</span>
              <input type="file" accept=".csv,.txt,.md,.markdown,.docx,text/csv,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document" disabled={busy} onChange={(event) => { void chooseFile(event.target.files?.[0]) }} />
            </div>
          </>}

          {step === 'preview' && isProcessing && <section className={styles.processing} role="status">
            <strong>{creatingDraft ? '正在创建导入任务' : queued ? `已加入处理队列，共 ${draft?.totalBatches ?? 1} 批` : `正在自动处理全部 ${draft?.totalBatches ?? 1} 批词典数据`}</strong>
            <p>{creatingDraft ? `已读取 ${parsed?.entries.length ?? 0} 条记录，正在保存草稿并启动词典匹配。` : queued ? '当前排在处理队列中，等待前面的导入任务完成。轮到后会自动开始词典匹配，关闭窗口也不会丢失草稿进度。' : `${matchProgress.completed}/${matchProgress.total} 条记录已完成。全部批次结束后会统一汇总问题，无需逐批确认；关闭窗口也不会丢失草稿进度。`}</p>
            {creatingDraft
              ? <progress aria-label="正在创建导入任务" />
              : queued
                ? <progress aria-label="排队等待词典匹配" />
                : <progress value={matchProgress.completed} max={Math.max(1, matchProgress.total)} aria-label="词典匹配进度" />}
            <small>{creatingDraft ? '正在连接服务器…' : queued ? '排队中，无需操作' : `${matchProgress.percent}%`}</small>
          </section>}

          {step === 'preview' && !isProcessing && <>
            <div className={styles.summary}>
              <span className={styles.pill}>正常词条 {readyCount}</span>
              {invalidCount > 0 && <span className={styles.pill}>格式无效 {invalidCount}</span>}
              {duplicateCount > 0 && <span className={styles.pill}>文件内重复 {duplicateCount}</span>}
              {unmatchedCount > 0 && <span className={styles.pill}>未匹配 {unmatchedCount} 词</span>}
              {conflictCount > 0 && <span className={styles.pill}>与词本冲突 {conflictCount} 词</span>}
              {continuationCount > 1 && <span className={styles.pill}>{continuationCount} 批已全部处理</span>}
            </div>
            <p className={styles.problemIntro}>{problems.length > 0 ? `全部批次处理完成。以下汇总 ${problems.length} 条需要确认的记录，设置处理方式后只需提交一次。` : '全部批次处理完成，未发现需要处理的问题，可以一次性完成导入。'}</p>
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
            {problems.length === 0 ? <div className={styles.problemEmpty}>无需逐条确认，点击下方按钮即可导入全部词条。</div> : <>
              <section className={styles.bulkActions} aria-label="批量处理导入问题">
                {commitMode === 'append' && conflictCount > 0 && <div className={styles.bulkGroup}><strong>词本冲突</strong><span>统一：</span>
                  <button type="button" onClick={() => setBulkDecision('conflict', 'keep')}>保留原词</button>
                  <button type="button" onClick={() => setBulkDecision('conflict', 'replace')}>全部覆盖</button>
                  <button type="button" onClick={() => setBulkDecision('conflict', 'merge')}>合并释义</button>
                </div>}
                {commitMode === 'overwrite' && conflictCount > 0 && <div className={styles.bulkGroup}><strong>词本冲突</strong><span>覆盖模式会采用导入词条，并保留同名词的学习进度。</span></div>}
                {duplicateCount > 0 && <div className={styles.bulkGroup}><strong>文件内重复</strong><span>统一：</span>
                  <button type="button" onClick={() => setBulkDecision('duplicate', 'keep')}>保留首条</button>
                  <button type="button" onClick={() => setBulkDecision('duplicate', 'replace')}>采用后条</button>
                  <button type="button" onClick={() => setBulkDecision('duplicate', 'merge')}>合并释义</button>
                </div>}
                {unmatchedCount > 0 && <div className={styles.bulkGroup}><strong>未匹配词典</strong><span>统一：</span>
                  <button type="button" onClick={() => setBulkDecision('unmatched', 'keep')}>保留</button>
                  <button type="button" onClick={() => setBulkDecision('unmatched', 'discard')}>移除</button>
                </div>}
                {invalidCount > 0 && <div className={styles.bulkGroup}><strong>格式无效</strong><span>将统一跳过；如需保留，请返回源文件修改后重新解析。</span></div>}
              </section>
              <table className={styles.table}>
                <thead><tr><th>行</th><th>词条</th><th>词性 / 英文释义 / 例句</th><th>中文释义</th><th>问题</th><th>处理</th></tr></thead>
                <tbody>
                  {visibleProblems.map((entry) => {
                    const key = decisionKey(entry)
                    const decision = decisions[key] ?? entry.resolution ?? (entry.status === 'conflict' || entry.status === 'duplicate' || entry.status === 'unmatched' ? 'keep' : undefined)
                    return <tr key={key}>
                      <td>{entry.line}</td><td>{entry.word || '暂无'}</td>
                      <td>
                        <strong>{entry.pos || entry.entry?.meanings[0]?.pos || '暂无'}</strong>
                        {(entry.enDefinition || entry.entry?.meanings[0]?.definition) && <div>{entry.enDefinition || entry.entry?.meanings[0]?.definition}</div>}
                        {(entry.example || entry.entry?.meanings[0]?.example) && <div className={styles.muted}>{entry.example || entry.entry?.meanings[0]?.example}</div>}
                      </td>
                      <td>{entry.zhMeaning || entry.entry?.zhMeaning || '暂无'}</td>
                      <td><span className={`${styles.status} ${statusClass(entry.status)}`}>{statusLabel[entry.status]}</span>{entry.reason && <div className={styles.muted}>{entry.reason}</div>}</td>
                      <td>
                        {commitMode === 'append' && entry.status === 'conflict' && <div className={styles.actions}>
                          {(['keep', 'replace', 'merge'] as const).map((choice) => <button type="button" className={`${styles.choice} ${decision === choice ? styles.choiceActive : ''}`} onClick={() => setDecision(entry, choice)} key={choice}>{choice === 'keep' ? '保留原词' : choice === 'replace' ? '覆盖原词' : '合并释义'}</button>)}
                        </div>}
                        {commitMode === 'overwrite' && entry.status === 'conflict' && <span className={styles.muted}>采用导入词条</span>}
                        {entry.status === 'duplicate' && <div className={styles.actions}>
                          {(['keep', 'replace', 'merge'] as const).map((choice) => <button type="button" className={`${styles.choice} ${decision === choice ? styles.choiceActive : ''}`} onClick={() => setDecision(entry, choice)} key={choice}>{choice === 'keep' ? '保留首条' : choice === 'replace' ? '采用此条' : '合并释义'}</button>)}
                        </div>}
                        {entry.status === 'unmatched' && <div className={styles.actions}>
                          <button type="button" className={`${styles.choice} ${decision === 'keep' ? styles.choiceActive : ''}`} onClick={() => setDecision(entry, 'keep')}>保留</button>
                          <button type="button" className={`${styles.choice} ${decision === 'discard' ? styles.choiceActive : ''}`} onClick={() => setDecision(entry, 'discard')}>移除</button>
                        </div>}
                        {entry.status === 'invalid' && <span className={styles.muted}>跳过</span>}
                      </td>
                    </tr>
                  })}
                </tbody>
              </table>
              {problemPages > 1 && <nav className={styles.problemPager} aria-label="问题记录分页">
                <button type="button" disabled={problemPage <= 1} onClick={() => setProblemPage((page) => Math.max(1, page - 1))}>上一页</button>
                <span>第 {problemPage}/{problemPages} 页</span>
                <button type="button" disabled={problemPage >= problemPages} onClick={() => setProblemPage((page) => Math.min(problemPages, page + 1))}>下一页</button>
              </nav>}
            </>}
          </>}
          {error && <p className={styles.error} role="alert">{error}</p>}
          </>}
        </div>
        <footer className={styles.footer}>
          {partialCompletion ? <Button variant="secondary" onClick={onClose}>完成</Button> : <>
            {step !== 'details' && !isProcessing && <Button variant="secondary" disabled={busy} onClick={() => { setError(''); setStep(step === 'preview' ? 'source' : 'details') }}>上一步</Button>}
            {step === 'details' && <Button disabled={busy} onClick={nextDetails}>下一步</Button>}
            {step === 'source' && <Button disabled={busy} onClick={() => { void createDraft() }}>{busy ? '正在匹配词典…' : '解析并预览'}</Button>}
            {step === 'preview' && !isProcessing && <Button disabled={busy || !draft} onClick={() => { void requestCommit() }}>{busy ? '正在保存…' : draft?.targetWordbookId ? commitMode === 'overwrite' ? '确认覆盖范围' : `确认并追加全部 ${continuationCount} 批` : '确认并创建单词本'}</Button>}
          </>}
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
