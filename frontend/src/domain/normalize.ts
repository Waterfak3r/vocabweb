/** Word query normalization and validation */

/** Trim, collapse internal whitespace, fold curly apostrophes, lowercase. */
export function normalizeWord(raw: string): string {
  // Word processors auto-convert to curly apostrophes; fold them so
  // "don’t" and "don't" are the same word for grading and dedupe.
  return raw.trim().replace(/\s+/g, ' ').replace(/[’ʼ]/g, "'").toLowerCase()
}

/**
 * A single English lemma: letters, with optional internal
 * hyphens and apostrophes (e.g. "well-known", "don't").
 */
const WORD_QUERY_PATTERN = /^[a-z]+(?:['’][a-z]+)*(?:-[a-z]+(?:['’][a-z]+)*)*$/

export function isValidWordQuery(query: string): boolean {
  return WORD_QUERY_PATTERN.test(query)
}

/** Wordbook id = normalized lemma (v1 single-lemma uniqueness). */
export function wordbookId(word: string): string {
  return normalizeWord(word)
}
