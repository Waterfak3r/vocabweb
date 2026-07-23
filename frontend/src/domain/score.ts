import { normalizeWord } from './normalize'
import type { DictationAnswer, DictationGrade, WordbookItem } from './types'

/** Dictation grading: exact normalized match. */
export function gradeAnswer(given: string, item: WordbookItem): DictationGrade {
  return normalizeWord(given) === item.word ? 'correct' : 'incorrect'
}

export function countCorrect(answers: DictationAnswer[]): number {
  return answers.filter((a) => a.grade === 'correct').length
}

/** Items answered incorrectly, for a wrong-only retry deck. */
export function wrongItems(
  answers: DictationAnswer[],
  deck: WordbookItem[],
): WordbookItem[] {
  const wrongIds = new Set(
    answers.filter((a) => a.grade === 'incorrect').map((a) => a.itemId),
  )
  return deck.filter((item) => wrongIds.has(item.id))
}

/** Fisher–Yates shuffle on a copy. */
export function shuffled<T>(items: readonly T[]): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}
