import { useCallback, useMemo, useState } from 'react'
import { shuffled } from '../../domain/score'
import type { FlashcardVerdict, WordbookItem } from '../../domain/types'

export type FlashcardSession = {
  /** Cards still to review (unknowns re-queue at the end) */
  current: WordbookItem | undefined
  flipped: boolean
  /** Cards completed in this round. A retry does not inflate progress. */
  reviewedCount: number
  /** Increments after every verdict, including re-queued appearances. */
  appearanceIndex: number
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

export function nextQueueAfterVerdict<T>(queue: readonly T[], verdict: FlashcardVerdict): T[] {
  if (!queue.length) return []
  return verdict === 'know'
    ? queue.slice(1)
    : [...queue.slice(1), queue[0]!]
}

/**
 * Session-only flashcard queue:
 * 认识 completes the card once; 掌握 removes it; 不认识 sends it to the back of the queue.
 * A verdict can be made from either face; flipping is a learner aid, not a gate.
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
  const [appearanceIndex, setAppearanceIndex] = useState(0)

  const totalCount = items.length
  const current = queue[0]
  const done = queue.length === 0 && totalCount > 0

  const flip = useCallback(() => setFlipped((value) => !value), [])

  const markKnown = useCallback(() => {
    if (!current) return
    setKnownIds((ids) => ids.includes(current.id) ? ids : [...ids, current.id])
    setQueue((q) => nextQueueAfterVerdict(q, 'know'))
    setReviewedCount((count) => count + 1)
    setAppearanceIndex((index) => index + 1)
    setFlipped(false)
    try {
      onVerdict?.(current.word, 'know')
    } catch {
      // Reporting learning activity must never interrupt the card session.
    }
  }, [current, onVerdict])

  const markUnknown = useCallback(() => {
    if (!current) return
    setUnknownIds((ids) => (ids.includes(current.id) ? ids : [...ids, current.id]))
    setQueue((q) => nextQueueAfterVerdict(q, 'unknown'))
    setAppearanceIndex((index) => index + 1)
    setFlipped(false)
    try {
      onVerdict?.(current.word, 'unknown')
    } catch {
      // Reporting learning activity must never interrupt the card session.
    }
  }, [current, onVerdict])

  const markMastered = useCallback(() => {
    if (!current || !flipped) return
    // Remove the card outright — no requeue, and it stays out of the known tally.
    setQueue((q) => q.slice(1))
    setReviewedCount((count) => count + 1)
    setAppearanceIndex((index) => index + 1)
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
    setAppearanceIndex(0)
  }, [items])

  return useMemo(
    () => ({
      current,
      flipped,
      reviewedCount,
      appearanceIndex,
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
    [current, flipped, reviewedCount, appearanceIndex, totalCount, knownIds.length, unknownIds.length, done, flip, markKnown, markUnknown, markMastered, restart],
  )
}
