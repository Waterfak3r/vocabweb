import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader } from '../components/layout/PageHeader'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { ProgressBar } from '../components/ui/ProgressBar'
import { Flashcard } from '../components/word/Flashcard'
import { FlashcardControls } from '../components/word/FlashcardControls'
import { ShortcutHint } from '../components/word/ShortcutHint'
import { selectWordbookItems, useWordbook } from '../data/wordbookStore'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'
import { useFlashcardSession } from '../features/flashcards/useFlashcardSession'

export function FlashcardsPage() {
  useDocumentTitle('单词卡')

  const items = useWordbook(selectWordbookItems)
  const session = useFlashcardSession(items)

  const shortcuts = useMemo(
    () => [
      { key: ' ', action: session.done ? () => {} : session.flip },
      { key: 'f', action: session.markUnknown },
      { key: 'j', action: session.markKnown },
    ],
    [session.flip, session.markKnown, session.markUnknown, session.done],
  )
  useKeyboardShortcuts(shortcuts, items.length > 0 && !session.done)

  if (items.length === 0) {
    return (
      <section className="page" aria-labelledby="flashcards-title">
        <PageHeader eyebrow="单词卡" title="单词卡" />
        <EmptyState
          title="还没有可复习的词"
          body="先收入几个词再来。"
          action={
            <Link to="/wordbook">
              <Button>去单词本</Button>
            </Link>
          }
        />
      </section>
    )
  }

  if (session.done) {
    return (
      <section className="page" aria-labelledby="flashcards-title">
        <PageHeader eyebrow="单词卡" title="本轮结束" />
        <div className="dictation-summary">
          <p className="dictation-score">
            掌握 <strong>{session.knownCount}</strong> 词，共 {session.totalCount} 词
          </p>
          {session.unknownCount > 0 && (
            <p className="page-description">
              {session.unknownCount} 个不熟的词会在下一轮继续出现。
            </p>
          )}
          <div className="dictation-summary-actions">
            <Button onClick={session.restart}>再来一轮</Button>
            <Link to="/wordbook">
              <Button variant="secondary">回单词本</Button>
            </Link>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="page study-stage" aria-labelledby="flashcards-title">
      <PageHeader
        eyebrow="单词卡"
        title="单词卡"
        aside={<ProgressBar value={session.reviewedCount} max={session.totalCount} label="复习进度" />}
      />

      {session.current && (
        <Flashcard item={session.current} flipped={session.flipped} onFlip={session.flip} />
      )}

      <FlashcardControls
        flipped={session.flipped}
        onFlip={session.flip}
        onKnow={session.markKnown}
        onUnknown={session.markUnknown}
        disableVerdicts={!session.flipped}
      />

      <ShortcutHint
        shortcuts={[
          { keys: '空格', action: '翻面' },
          { keys: 'F', action: '不熟' },
          { keys: 'J', action: '掌握' },
        ]}
      />
    </section>
  )
}
