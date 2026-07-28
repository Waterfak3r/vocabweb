/** Word query normalization and validation */

/** Trim, collapse internal whitespace, fold curly apostrophes, lowercase. */
export function normalizeWord(raw: string): string {
  // Word processors auto-convert to curly apostrophes; fold them so
  // "don’t" and "don't" are the same word for grading and dedupe.
  return raw
    .trim()
    .replace(/…/g, '...')
    .replace(/[‐‑]/g, '-')
    .replace(/([a-z])\s*-\s*(?=[a-z])/gi, '$1-')
    .replace(/([a-z.])\s*\(\s*([a-z0-9]{2,12}|[a-z0-9]{1,8}(?:[&/-][a-z0-9]{1,8}){1,3})\s*\)\s*$/i, '$1 ($2)')
    .replace(/\s+/g, ' ')
    .replace(/[’ʼ]/g, "'")
    .toLowerCase()
}

const BASE_WORD_TOKEN = "[a-z]+(?:['’][a-z]+)*(?:-[a-z]+(?:['’][a-z]+)*)*"
// Learner phrase lists conventionally use sb./sth. as grammatical slots.
// Keep the exception narrow so arbitrary punctuation still cannot enter a headword.
const WORD_TOKEN = `(?:${BASE_WORD_TOKEN}|s(?:b|th|mb|mth)\\.)`
const ELLIPSIS = "\\.\\.\\."
const QUERY_TOKEN = `(?:(?:${ELLIPSIS})?${WORD_TOKEN}(?:${ELLIPSIS}${WORD_TOKEN})*(?:${ELLIPSIS})?|${ELLIPSIS})`
const ABBREVIATION = "(?:[a-z0-9]{2,12}|[a-z0-9]{1,8}(?:[&/-][a-z0-9]{1,8}){1,3})"
const TRAILING_ABBREVIATION = `\\(${ABBREVIATION}\\)`
const WORD_QUERY_PATTERN = new RegExp(`^${QUERY_TOKEN}(?: ${QUERY_TOKEN})*(?: ${TRAILING_ABBREVIATION})?$`)
export const MAX_WORD_QUERY_LENGTH = 160

export function isValidWordQuery(query: string): boolean {
  return query.length <= MAX_WORD_QUERY_LENGTH && WORD_QUERY_PATTERN.test(query)
}

/** Wordbook id = normalized lemma or phrase. */
export function wordbookId(word: string): string {
  return normalizeWord(word)
}
