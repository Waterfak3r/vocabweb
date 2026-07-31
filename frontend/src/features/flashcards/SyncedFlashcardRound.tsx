import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Flashcard } from '../../components/word/Flashcard'
import { ShortcutHint } from '../../components/word/ShortcutHint'
import type { EnglishAccent } from '../../data/pronunciationPreferences'
import type { FlashcardDisplayPreferences } from '../../data/studyPreferences'
import { shortcutLabel, type StudyShortcutPreferences } from '../../data/studyShortcuts'
import {
  WorkspaceApiError,
  getWorkspaceApi,
  type LearningVerdict,
  type StudyChoiceOption,
  type StudyRound,
  type StudyRoundMode,
  type StudyRoundScope,
} from '../../data/workspaceApi'
import type { WordbookItem } from '../../domain/types'
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts'
import { usePronounce } from '../../hooks/usePronounce'

type SyncedFlashcardRoundProps = {
  wordbookId: string
  entries: WordbookItem[]
  mode: StudyRoundMode
  scope: StudyRoundScope
  preferences: FlashcardDisplayPreferences
  shortcuts: StudyShortcutPreferences
  accent: EnglishAccent
  nextReviewDays?: number
  onProgressCommitted?: () => void
  onClose: () => void
}

function scopeLabel(scope: StudyRoundScope, mode: StudyRoundMode) {
  if (scope === 'backlog') return '清理历史积压'
  if (scope === 'ahead') return mode === 'new' ? '提前学习' : '提前复习'
  return '今日任务'
}

export function SyncedFlashcardRound({
  wordbookId,
  entries,
  mode,
  scope,
  preferences,
  shortcuts,
  accent,
  nextReviewDays,
  onProgressCommitted,
  onClose,
}: SyncedFlashcardRoundProps) {
  const api = getWorkspaceApi()
  const [round, setRound] = useState<StudyRound | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [resumeDecisionPending, setResumeDecisionPending] = useState(false)
  const [busy, setBusy] = useState(false)
  const [flipped, setFlipped] = useState(false)
  const [pendingVerdict, setPendingVerdict] = useState<Exclude<LearningVerdict, 'know'> | null>(null)
  const [options, setOptions] = useState<StudyChoiceOption[]>([])
  const [optionsLoading, setOptionsLoading] = useState(false)
  const [selectedOption, setSelectedOption] = useState<StudyChoiceOption | null>(null)
  const startedRef = useRef(false)

  const start = useCallback(async () => {
    if (!api) {
      setError('未配置后端地址，无法同步学习进度。')
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const result = await api.startStudyRound(wordbookId, mode, scope)
      setRound(result.round)
      setResumeDecisionPending(result.resumed && result.round.queue.length > 0)
    } catch {
      setError('学习任务加载失败，请检查网络后重试。')
    } finally {
      setLoading(false)
    }
  }, [api, mode, scope, wordbookId])

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    void start()
  }, [start])

  const task = round?.queue[0]
  const current = useMemo(
    () => entries.find((entry) => entry.id === task?.wordId),
    [entries, task?.wordId],
  )
  const { pronounce, stop } = usePronounce(current?.word ?? '', .85, accent)

  useEffect(() => {
    setFlipped(false)
    setPendingVerdict(null)
    setSelectedOption(null)
    setOptions([])
    setError('')
  }, [task?.id])

  useEffect(() => {
    if (!api || !round || !task || task.exercise !== 'meaning-choice' || resumeDecisionPending) return
    let active = true
    setOptionsLoading(true)
    void api.getStudyRoundTaskOptions(round.id, task.id, preferences.meaningPreference)
      .then((result) => {
        if (active) setOptions(result.options)
      })
      .catch(() => {
        if (active) setError('释义选项加载失败，请稍后重试。')
      })
      .finally(() => {
        if (active) setOptionsLoading(false)
      })
    return () => {
      active = false
    }
  }, [api, preferences.meaningPreference, resumeDecisionPending, round?.id, task?.exercise, task?.id])

  useEffect(() => {
    if (!preferences.autoPlayAudio || !current || resumeDecisionPending) return
    const timer = window.setTimeout(pronounce, 0)
    return () => {
      window.clearTimeout(timer)
      stop()
    }
  }, [current?.id, preferences.autoPlayAudio, pronounce, resumeDecisionPending, stop])

  const refreshAfterConflict = useCallback(async (roundId: string) => {
    if (!api) return
    try {
      const latest = await api.getStudyRound(roundId)
      setRound(latest)
      setError('另一台设备刚刚更新了本轮进度，已切换到最新题目。')
    } catch {
      setError('本轮进度已在另一台设备结束或过期，请重新打开学习。')
    }
  }, [api])

  const commit = useCallback(async (response: LearningVerdict | 'correct' | 'incorrect') => {
    if (!api || !round || !task || busy) return
    setBusy(true)
    setError('')
    try {
      const updated = await api.answerStudyRound(round.id, {
        taskId: task.id,
        response,
        operationId: crypto.randomUUID(),
        revision: round.revision,
      })
      setRound(updated)
      onProgressCommitted?.()
    } catch (caught) {
      if (caught instanceof WorkspaceApiError && caught.status === 409) {
        await refreshAfterConflict(round.id)
      } else {
        setError('答案暂未同步，当前题目会保留，请重试。')
      }
    } finally {
      setBusy(false)
    }
  }, [api, busy, onProgressCommitted, refreshAfterConflict, round, task])

  const rotateAndResume = useCallback(async () => {
    if (!api || !round || busy) return
    setBusy(true)
    setError('')
    try {
      const updated = await api.rotateStudyRound(round.id, round.revision)
      setRound(updated)
      setResumeDecisionPending(false)
    } catch (caught) {
      if (caught instanceof WorkspaceApiError && caught.status === 409) {
        await refreshAfterConflict(round.id)
        setResumeDecisionPending(false)
      } else {
        setError('暂时无法调整顺序，请重试或按原顺序继续。')
      }
    } finally {
      setBusy(false)
    }
  }, [api, busy, refreshAfterConflict, round])

  const showUncertainAnswer = useCallback((verdict: 'vague' | 'unknown') => {
    if (busy || pendingVerdict) return
    setPendingVerdict(verdict)
    setFlipped(true)
  }, [busy, pendingVerdict])

  const continueFeedback = useCallback(() => {
    if (pendingVerdict) {
      void commit(pendingVerdict)
      return
    }
    if (selectedOption && task) {
      void commit(selectedOption.wordId === task.wordId ? 'correct' : 'incorrect')
    }
  }, [commit, pendingVerdict, selectedOption, task])

  const shortcutBindings = useMemo(() => {
    if (!task || resumeDecisionPending || busy) return []
    if (task.exercise === 'meaning-choice') {
      return [{ key: shortcuts.pronounce, action: pronounce }]
    }
    if (pendingVerdict) {
      return [{ key: shortcuts.pronounce, action: pronounce }]
    }
    return [
      { key: shortcuts.unknown, action: () => showUncertainAnswer('unknown') },
      { key: shortcuts.vague, action: () => showUncertainAnswer('vague') },
      { key: shortcuts.pronounce, action: pronounce },
      { key: shortcuts.known, action: () => { void commit('know') } },
      { key: shortcuts.flip, action: () => setFlipped((value) => !value) },
    ]
  }, [busy, commit, pendingVerdict, pronounce, resumeDecisionPending, shortcuts, showUncertainAnswer, task])
  useKeyboardShortcuts(shortcutBindings, Boolean(task) && !selectedOption)

  if (loading) {
    return <div className="synced-round-state" role="status"><span className="study-round-spinner" />正在同步学习进度…</div>
  }
  if (!round) {
    return <EmptyState title="无法载入学习任务" body={error || '学习服务暂不可用。'} action={<Button onClick={() => { startedRef.current = false; void start() }}>重试</Button>} />
  }
  if (resumeDecisionPending) {
    const remaining = Math.max(0, round.wordIds.length - round.completedWordIds.length)
    return <div className="study-resume-choice">
      <p className="marginal">跨设备学习进度</p>
      <h2>继续上次的 {remaining} 词？</h2>
      <p>任务顺序和已完成的练习都已保存。你可以原样继续，也可以把当前第一个词移到队尾，减少短时记忆干扰。</p>
      <small>上次更新：{new Date(round.updatedAt).toLocaleString('zh-CN')}</small>
      {error && <p className="study-round-error" role="alert">{error}</p>}
      <div>
        <Button disabled={busy} onClick={() => setResumeDecisionPending(false)}>按原顺序继续</Button>
        <Button variant="secondary" disabled={busy} onClick={() => { void rotateAndResume() }}>换个词开始</Button>
      </div>
    </div>
  }
  if (round.queue.length === 0 || round.completedAt) {
    return <div className="workspace-session-summary synced-round-summary">
      <p>{scopeLabel(round.scope, round.mode)}完成</p>
      <h2>已完成 <strong>{round.completedWordIds.length}</strong> 词、两类练习均已过关</h2>
      <p>
        {round.unknownWordIds.length
          ? `${round.unknownWordIds.length} 个词曾答错，已降低熟练度并安排短期回访。`
          : round.vagueWordIds.length
            ? `${round.vagueWordIds.length} 个词曾感到模糊，熟练度保持不变并缩短复习间隔。`
            : '本轮没有模糊或错误记录。'}
      </p>
      <div><Button variant="secondary" onClick={onClose}>关闭窗口</Button></div>
    </div>
  }
  if (!task || !current) {
    return <EmptyState title="当前词条不可用" body="词条可能已在另一台设备被删除，请关闭后重新开始。" action={<Button onClick={onClose}>关闭窗口</Button>} />
  }

  const completedCount = round.completedWordIds.length
  const taskLabel = task.exercise === 'self-rating' ? '回忆判断' : '看词选义'
  const correctOption = options.find((option) => option.wordId === task.wordId)
  const selectedCorrect = selectedOption?.wordId === task.wordId

  return <>
    <div className="workspace-study-progress synced-round-progress">
      <span>{scopeLabel(scope, mode)} · {taskLabel}</span>
      <strong>已完成 {completedCount} / {round.wordIds.length} 词</strong>
    </div>
    {error && <p className="study-round-error" role="alert">{error}</p>}
    {task.exercise === 'self-rating' ? <>
      <Flashcard
        item={current}
        flipped={flipped}
        onFlip={() => {
          if (!pendingVerdict) setFlipped((value) => !value)
        }}
        preferences={preferences}
      />
      {pendingVerdict ? <div className={`study-answer-feedback ${pendingVerdict}`}>
        <strong>{pendingVerdict === 'vague' ? '已记为模糊' : '已记为不认识'}</strong>
        <span>{pendingVerdict === 'vague' ? '熟练度不下降，但会缩短下次间隔，并在本轮稍后再问。' : '会降低复习熟练度，并在本轮稍后再问。'}</span>
        <Button disabled={busy} onClick={continueFeedback}>{busy ? '同步中…' : '继续'}</Button>
      </div> : <div className="study-actions study-verdicts three-way">
        <button className="study-verdict unknown" type="button" disabled={busy} onClick={() => showUncertainAnswer('unknown')}><span>不认识</span><i aria-hidden="true" /></button>
        <button className="study-verdict vague" type="button" disabled={busy} onClick={() => showUncertainAnswer('vague')}><span>模糊</span><i aria-hidden="true" /></button>
        <button className="study-verdict known" type="button" disabled={busy} onClick={() => { void commit('know') }}><span>{busy ? '同步中…' : '认识'}</span><i aria-hidden="true" /></button>
        {!flipped && <button className="study-flip" type="button" disabled={busy} onClick={() => setFlipped(true)}>翻面</button>}
        {nextReviewDays !== undefined && <p className="study-next-review-hint">两项练习都完成后进入「初识」，约 {nextReviewDays} 天后复习</p>}
      </div>}
      <ShortcutHint shortcuts={[
        { keys: shortcutLabel(shortcuts.unknown), action: '不认识' },
        { keys: shortcutLabel(shortcuts.vague), action: '模糊' },
        { keys: shortcutLabel(shortcuts.pronounce), action: '发音' },
        { keys: shortcutLabel(shortcuts.known), action: '认识' },
        { keys: shortcutLabel(shortcuts.flip), action: '翻面' },
      ]} />
    </> : <div className="meaning-choice-stage">
      <header>
        <p className="marginal">选择最符合的释义</p>
        <h2>{current.word}</h2>
        {preferences.showPhonetic && current.phonetic && <span>{current.phonetic}</span>}
        <button type="button" onClick={pronounce}>播放发音</button>
      </header>
      {optionsLoading ? <div className="synced-round-state" role="status">正在准备相近词干扰项…</div> : options.length ? (
        <div className="meaning-choice-options" role="group" aria-label={`${current.word} 的释义选项`}>
          {options.map((option, index) => {
            const chosen = selectedOption?.wordId === option.wordId
            const correct = option.wordId === task.wordId
            const feedbackClass = selectedOption
              ? correct ? ' correct' : chosen ? ' incorrect' : ' subdued'
              : ''
            return <button
              type="button"
              key={`${option.wordId}-${index}`}
              className={`${chosen ? 'selected' : ''}${feedbackClass}`}
              disabled={Boolean(selectedOption) || busy}
              onClick={() => setSelectedOption(option)}
            >
              <b>{String.fromCharCode(65 + index)}</b>
              <span><strong>{option.pos}</strong>{option.definition}</span>
              {selectedOption && <small>释义来源：{option.word}</small>}
            </button>
          })}
        </div>
      ) : <div className="meaning-choice-unavailable">
        <p>这个词还没有足够的可用释义，无法生成选择题。</p>
        <Button disabled={busy} onClick={() => { void commit('correct') }}>跳过本题并保留进度</Button>
      </div>}
      {selectedOption && <div className={`meaning-choice-feedback ${selectedCorrect ? 'correct' : 'incorrect'}`}>
        <strong>{selectedCorrect ? '选择正确' : '选择错误'}</strong>
        <span>{selectedCorrect ? '已找到对应释义。' : `正确释义来自 ${correctOption?.word ?? current.word}。本题会在队尾再次出现。`}</span>
        <Button disabled={busy} onClick={continueFeedback}>{busy ? '同步中…' : '继续'}</Button>
      </div>}
      <ShortcutHint shortcuts={[{ keys: shortcutLabel(shortcuts.pronounce), action: '发音' }]} />
    </div>}
  </>
}
