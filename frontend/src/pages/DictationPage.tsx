import { useEffect, useMemo, useRef } from 'react'
import { PageHeader } from '../components/layout/PageHeader'
import { Button, ButtonLink } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { ProgressBar } from '../components/ui/ProgressBar'
import { DictationPrompt } from '../components/word/DictationPrompt'
import { DictationSummary } from '../components/word/DictationSummary'
import { ShortcutHint } from '../components/word/ShortcutHint'
import { selectWordbookItems, useWordbook } from '../data/wordbookStore'
import { useDictationSession } from '../features/dictation/useDictationSession'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'
import { usePronounce } from '../hooks/usePronounce'

export function DictationPage() {
  useDocumentTitle('听写')

  const items = useWordbook(selectWordbookItems)
  const session = useDictationSession(items)
  const { pronounce } = usePronounce(
    session.current?.word ?? '',
    session.current?.audioUrl,
    0.78,
  )

  // Auto-play once when a new card appears.
  const lastPlayedId = useRef<string | null>(null)
  useEffect(() => {
    if (!session.current || session.phase !== 'prompt') return
    if (lastPlayedId.current === session.current.id) return
    const currentId = session.current.id
    const timer = window.setTimeout(() => {
      lastPlayedId.current = currentId
      pronounce()
    }, 350)
    return () => window.clearTimeout(timer)
  }, [session.current, session.phase, pronounce])

  const shortcuts = useMemo(
    () => [{ key: 'enter', ctrl: true, action: pronounce, allowInInput: true }],
    [pronounce],
  )
  useKeyboardShortcuts(shortcuts, items.length > 0 && session.phase !== 'summary')

  if (items.length === 0) {
    return (
      <section className="page" aria-labelledby="dictation-title">
        <PageHeader eyebrow="听写" title="听写" />
        <EmptyState
          title="还没有可听写的词"
          body="单词本有词之后再开始。"
          action={
            <ButtonLink to="/wordbook">去单词本</ButtonLink>
          }
        />
      </section>
    )
  }

  if (session.phase === 'summary') {
    return (
      <section className="page" aria-labelledby="dictation-title">
        <PageHeader eyebrow="听写" title="本轮结束" />
        <DictationSummary
          total={session.deck.length}
          correct={session.correctCount}
          wrong={session.wrongDeck}
          onRetryAll={session.retryAll}
          onRetryWrong={session.retryWrong}
        />
      </section>
    )
  }

  const lastAnswer = session.answers[session.answers.length - 1]

  return (
    <section className="page study-stage" aria-labelledby="dictation-title">
      <PageHeader
        eyebrow="听写"
        title="听写"
        aside={
          <ProgressBar
            value={session.index + 1}
            max={session.deck.length}
            label="听写进度"
          />
        }
      />

      {session.current && (
        <DictationPrompt
          item={session.current}
          answer={session.answer}
          onAnswerChange={session.setAnswer}
          onSubmit={session.submit}
          onNext={session.next}
          onPlay={pronounce}
          phase={session.phase}
          grade={session.phase === 'feedback' ? (lastAnswer?.grade ?? null) : null}
          error={session.inputError}
          isLast={session.isLast}
        />
      )}

      <ShortcutHint
        shortcuts={[
          { keys: 'Enter', action: session.phase === 'prompt' ? '提交' : '下一题' },
          { keys: 'Ctrl+Enter', action: '重播发音' },
        ]}
      />
    </section>
  )
}
