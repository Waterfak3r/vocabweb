import { useCallback, useMemo, useState } from 'react'
import { gradeAnswer, shuffled } from '../../domain/score'
import type { DictationAnswer, WordbookItem } from '../../domain/types'

export type DictationPhase = 'prompt' | 'feedback' | 'summary'
export const REQUIRED_DICTATION_STREAK = 3

export type DictationSession = {
  deck: WordbookItem[]
  current: WordbookItem | undefined
  index: number
  isLast: boolean
  phase: DictationPhase
  answer: string
  answers: DictationAnswer[]
  inputError: string
  correctCount: number
  passedCount: number
  remainingCount: number
  currentStreak: number
  requiredStreak: number
  attemptCount: number
  incorrectCount: number
  wrongDeck: WordbookItem[]
  setAnswer: (value: string) => void
  submit: () => void
  skip: () => void
  next: () => void
  retryAll: () => void
  retryWrong: () => void
}

export type DictationGradeReporter = (word: string, correct: boolean) => void

export function advanceDictationStreak(current: number, correct: boolean) {
  const streak = correct ? Math.min(REQUIRED_DICTATION_STREAK, current + 1) : 0
  return { streak, passed: correct && streak === REQUIRED_DICTATION_STREAK }
}

export function skippedDictationAnswer(
  item: Pick<WordbookItem, 'id' | 'word'>,
): DictationAnswer {
  return {
    itemId: item.id,
    word: item.word,
    given: '',
    grade: 'incorrect',
    skipped: true,
  }
}

/** A word passes after three consecutive correct attempts in this open session. */
export function useDictationSession(
  items: readonly WordbookItem[],
  onGrade?: DictationGradeReporter,
): DictationSession {
  const [deck, setDeck] = useState<WordbookItem[]>(() => shuffled(items))
  const [queue, setQueue] = useState<WordbookItem[]>(() => deck)
  const [phase, setPhase] = useState<DictationPhase>('prompt')
  const [answer, setAnswerState] = useState('')
  const [answers, setAnswers] = useState<DictationAnswer[]>([])
  const [inputError, setInputError] = useState('')
  const [streaks, setStreaks] = useState<Record<string, number>>({})
  const [passedIds, setPassedIds] = useState<string[]>([])
  const [troubleIds, setTroubleIds] = useState<string[]>([])
  const [lastPassed, setLastPassed] = useState(false)

  const current = queue[0]
  const currentStreak = current ? streaks[current.id] ?? 0 : 0
  const isLast = phase === 'feedback' && lastPassed && queue.length === 1

  const setAnswer = useCallback((value: string) => {
    setAnswerState(value)
    setInputError('')
  }, [])

  const finishAttempt = useCallback((attempt: DictationAnswer) => {
    if (!current || phase !== 'prompt') return
    const grade = attempt.grade
    const { streak: nextStreak, passed } = advanceDictationStreak(
      streaks[current.id] ?? 0,
      grade === 'correct',
    )
    setAnswers((list) => [...list, attempt])
    setStreaks((value) => ({ ...value, [current.id]: nextStreak }))
    setLastPassed(passed)
    if (passed) setPassedIds((ids) => ids.includes(current.id) ? ids : [...ids, current.id])
    if (grade === 'incorrect') setTroubleIds((ids) => ids.includes(current.id) ? ids : [...ids, current.id])
    setPhase('feedback')
    try {
      if (passed) onGrade?.(current.word, true)
      else if (grade === 'incorrect') onGrade?.(current.word, false)
    } catch {
      // Local grading remains available when reporting is offline.
    }
  }, [current, onGrade, phase, streaks])

  const submit = useCallback(() => {
    if (!current || phase !== 'prompt') return
    if (!answer.trim()) {
      setInputError('先写下你听到的拼写。')
      return
    }
    finishAttempt({
      itemId: current.id,
      word: current.word,
      given: answer.trim(),
      grade: gradeAnswer(answer, current),
    })
  }, [answer, current, finishAttempt, phase])

  const skip = useCallback(() => {
    if (!current || phase !== 'prompt') return
    finishAttempt(skippedDictationAnswer(current))
  }, [current, finishAttempt, phase])

  const next = useCallback(() => {
    if (phase !== 'feedback' || !current) return
    const nextQueue = lastPassed ? queue.slice(1) : [...queue.slice(1), current]
    setQueue(nextQueue)
    setAnswerState('')
    setInputError('')
    setLastPassed(false)
    setPhase(nextQueue.length ? 'prompt' : 'summary')
  }, [current, lastPassed, phase, queue])

  const startDeck = useCallback((nextItems: WordbookItem[]) => {
    const nextDeck = shuffled(nextItems)
    setDeck(nextDeck)
    setQueue(nextDeck)
    setPhase(nextDeck.length ? 'prompt' : 'summary')
    setAnswerState('')
    setAnswers([])
    setInputError('')
    setStreaks({})
    setPassedIds([])
    setTroubleIds([])
    setLastPassed(false)
  }, [])

  const retryAll = useCallback(() => startDeck([...items]), [items, startDeck])
  const wrongDeck = useMemo(() => deck.filter((item) => troubleIds.includes(item.id)), [deck, troubleIds])
  const retryWrong = useCallback(() => {
    if (wrongDeck.length) startDeck(wrongDeck)
  }, [startDeck, wrongDeck])

  const incorrectCount = answers.filter((entry) => entry.grade === 'incorrect').length
  return useMemo(() => ({
    deck,
    current,
    index: passedIds.length,
    isLast,
    phase,
    answer,
    answers,
    inputError,
    correctCount: passedIds.length,
    passedCount: passedIds.length,
    remainingCount: queue.length,
    currentStreak,
    requiredStreak: REQUIRED_DICTATION_STREAK,
    attemptCount: answers.length,
    incorrectCount,
    wrongDeck,
    setAnswer,
    submit,
    skip,
    next,
    retryAll,
    retryWrong,
  }), [answer, answers, current, currentStreak, deck, incorrectCount, inputError, isLast, next, passedIds.length, phase, queue.length, retryAll, retryWrong, setAnswer, skip, submit, wrongDeck])
}
