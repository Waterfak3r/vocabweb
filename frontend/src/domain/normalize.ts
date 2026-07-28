/** Word query normalization and validation */

/** Trim, collapse internal whitespace, fold curly apostrophes, lowercase. */
export function normalizeWord(raw: string): string {
  // Word processors auto-convert to curly apostrophes; fold them so
  // "don’t" and "don't" are the same word for grading and dedupe.
  return raw.trim().replace(/\s+/g, ' ').replace(/[’ʼ]/g, "'").toLowerCase()
}

const WORD_TOKEN = "[a-z]+(?:['’][a-z]+)*(?:-[a-z]+(?:['’][a-z]+)*)*"
const WORD_QUERY_PATTERN = new RegExp(`^${WORD_TOKEN}(?: ${WORD_TOKEN})*$`)
export const MAX_WORD_QUERY_LENGTH = 160

export function isValidWordQuery(query: string): boolean {
  return query.length <= MAX_WORD_QUERY_LENGTH && WORD_QUERY_PATTERN.test(query)
}

/** Wordbook id = normalized lemma or phrase. */
export function wordbookId(word: string): string {
  return normalizeWord(word)
}
