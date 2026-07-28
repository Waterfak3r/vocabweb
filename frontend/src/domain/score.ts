import { normalizeWord } from './normalize'
import type { DictationAnswer, DictationGrade, WordbookItem } from './types'

/**
 * Dictation compares what can reasonably be heard. Headword notation remains
 * visible, but periods, ellipsis slots, and lexical hyphens are not required.
 */
export function normalizeDictationText(value: string): string {
  return normalizeWord(value)
    .replace(/ \((?:[a-z0-9]{2,12}|[a-z0-9]{1,8}(?:[&/-][a-z0-9]{1,8}){1,3})\)$/i, '')
    .replace(/\.{3}/g, ' ')
    .replace(/\./g, '')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function gradeAnswer(given: string, item: WordbookItem): DictationGrade {
  return normalizeDictationText(given) === normalizeDictationText(item.word)
    ? 'correct'
    : 'incorrect'
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
