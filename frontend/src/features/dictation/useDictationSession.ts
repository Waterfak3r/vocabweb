import { useCallback, useMemo, useState } from 'react'
import { countCorrect, gradeAnswer, shuffled, wrongItems } from '../../domain/score'
import type { DictationAnswer, WordbookItem } from '../../domain/types'

export type DictationPhase = 'prompt' | 'feedback' | 'summary'

export type DictationSession = {
  deck: WordbookItem[]
  current: WordbookItem | undefined
  /** 0-based index into the deck */
  index: number
  isLast: boolean
  phase: DictationPhase
  answer: string
  answers: DictationAnswer[]
  inputError: string
  correctCount: number
  wrongDeck: WordbookItem[]
  setAnswer: (value: string) => void
  submit: () => void
  next: () => void
  retryAll: () => void
  retryWrong: () => void
}

export type DictationGradeReporter = (word: string, correct: boolean) => void

/** Session-only dictation: grade each spelling, then review the misses. */
export function useDictationSession(
  items: readonly WordbookItem[],
  onGrade?: DictationGradeReporter,
): DictationSession {
  const [deck, setDeck] = useState<WordbookItem[]>(() => shuffled(items))
  const [index, setIndex] = useState(0)
  const [phase, setPhase] = useState<DictationPhase>('prompt')
  const [answer, setAnswerState] = useState('')
  const [answers, setAnswers] = useState<DictationAnswer[]>([])
  const [inputError, setInputError] = useState('')

  const current = deck[index]
  const isLast = index === deck.length - 1

  const setAnswer = useCallback((value: string) => {
    setAnswerState(value)
    setInputError('')
  }, [])

  const submit = useCallback(() => {
    if (!current || phase !== 'prompt') return
    if (!answer.trim()) {
      setInputError('先写下你听到的拼写。')
      return
    }
    const grade = gradeAnswer(answer, current)
    setAnswers((list) => [
      ...list,
      { itemId: current.id, word: current.word, given: answer.trim(), grade },
    ])
    setPhase('feedback')
    try {
      onGrade?.(current.word, grade === 'correct')
    } catch {
      // Grading remains available if the optional backend is offline.
    }
  }, [current, phase, answer, onGrade])

  const next = useCallback(() => {
    if (phase !== 'feedback') return
    setAnswerState('')
    setInputError('')
    if (isLast) {
      setPhase('summary')
    } else {
      setIndex((i) => i + 1)
      setPhase('prompt')
    }
  }, [phase, isLast])

  const startDeck = useCallback((items_: WordbookItem[]) => {
    setDeck(shuffled(items_))
    setIndex(0)
    setPhase('prompt')
    setAnswerState('')
    setAnswers([])
    setInputError('')
  }, [])

  const retryAll = useCallback(() => startDeck([...items]), [items, startDeck])

  const retryWrong = useCallback(() => {
    const wrong = wrongItems(answers, deck)
    if (wrong.length > 0) startDeck(wrong)
  }, [answers, deck, startDeck])

  return useMemo(
    () => ({
      deck,
      current,
      index,
      isLast,
      phase,
      answer,
      answers,
      inputError,
      correctCount: countCorrect(answers),
      wrongDeck: wrongItems(answers, deck),
      setAnswer,
      submit,
      next,
      retryAll,
      retryWrong,
    }),
    [deck, current, index, isLast, phase, answer, answers, inputError, setAnswer, submit, next, retryAll, retryWrong],
  )
}
