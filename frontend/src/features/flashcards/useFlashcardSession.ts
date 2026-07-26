import { useCallback, useMemo, useState } from 'react'
import { shuffled } from '../../domain/score'
import type { FlashcardVerdict, WordbookItem } from '../../domain/types'

export type FlashcardSession = {
  /** Cards still to review (unknowns re-queue at the end) */
  current: WordbookItem | undefined
  flipped: boolean
  /** 1-based position within the original deck */
  reviewedCount: number
  totalCount: number
  knownCount: number
  unknownCount: number
  done: boolean
  flip: () => void
  markKnown: () => void
  markUnknown: () => void
  /** 标熟: drops the card from the queue entirely (no requeue), outside the known/unknown tallies. */
  markMastered: () => void
  restart: () => void
}

export type FlashcardVerdictReporter = (
  word: string,
  verdict: FlashcardVerdict,
) => void

export type FlashcardMasteredReporter = (word: string) => void

/**
 * Session-only flashcard queue:
 * 掌握 removes the card; 不熟 sends it to the back of the queue.
 * A verdict requires the card to be flipped first — recall before recognition.
 */
export function useFlashcardSession(
  items: readonly WordbookItem[],
  onVerdict?: FlashcardVerdictReporter,
  onMastered?: FlashcardMasteredReporter,
): FlashcardSession {
  const [queue, setQueue] = useState<WordbookItem[]>(() => shuffled(items))
  const [flipped, setFlipped] = useState(false)
  const [knownIds, setKnownIds] = useState<string[]>([])
  const [unknownIds, setUnknownIds] = useState<string[]>([])
  const [reviewedCount, setReviewedCount] = useState(0)

  const totalCount = items.length
  const current = queue[0]
  const done = queue.length === 0 && totalCount > 0

  const flip = useCallback(() => setFlipped((value) => !value), [])

  const markKnown = useCallback(() => {
    if (!current || !flipped) return
    setKnownIds((ids) => [...ids, current.id])
    setQueue((q) => q.slice(1))
    setReviewedCount((count) => count + 1)
    setFlipped(false)
    try {
      onVerdict?.(current.word, 'know')
    } catch {
      // Reporting learning activity must never interrupt the card session.
    }
  }, [current, flipped, onVerdict])

  const markUnknown = useCallback(() => {
    if (!current || !flipped) return
    setUnknownIds((ids) => (ids.includes(current.id) ? ids : [...ids, current.id]))
    // Re-queue at the end; don't advance the counter — we'll see it again.
    setQueue((q) => [...q.slice(1), q[0]])
    setReviewedCount((count) => Math.min(count + 1, totalCount))
    setFlipped(false)
    try {
      onVerdict?.(current.word, 'unknown')
    } catch {
      // Reporting learning activity must never interrupt the card session.
    }
  }, [current, flipped, totalCount, onVerdict])

  const markMastered = useCallback(() => {
    if (!current || !flipped) return
    // Remove the card outright — no requeue, and it stays out of the known/unknown
    // tallies — but it still advances the reviewed counter. A card the user first
    // marked 不熟 must leave that tally too, or the summary would claim there is
    // still something to review.
    setUnknownIds((ids) => ids.filter((id) => id !== current.id))
    setQueue((q) => q.slice(1))
    setReviewedCount((count) => count + 1)
    setFlipped(false)
    try {
      onMastered?.(current.word)
    } catch {
      // Reporting learning activity must never interrupt the card session.
    }
  }, [current, flipped, onMastered])

  const restart = useCallback(() => {
    setQueue(shuffled(items))
    setFlipped(false)
    setKnownIds([])
    setUnknownIds([])
    setReviewedCount(0)
  }, [items])

  return useMemo(
    () => ({
      current,
      flipped,
      reviewedCount: done ? totalCount : Math.min(reviewedCount + 1, totalCount),
      totalCount,
      knownCount: knownIds.length,
      unknownCount: unknownIds.length,
      done,
      flip,
      markKnown,
      markUnknown,
      markMastered,
      restart,
    }),
    [current, flipped, reviewedCount, totalCount, knownIds.length, unknownIds.length, done, flip, markKnown, markUnknown, markMastered, restart],
  )
}
