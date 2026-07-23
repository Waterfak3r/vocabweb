/** Provenance of definition data */
export type WordSource = 'local-ielts' | 'dictionary-api' | 'user' | 'backend'

export type WordMeaning = {
  /** Part of speech, lowercase display form, e.g. "adjective" */
  pos: string
  /** English gloss (dictionary data stays EN; UI chrome is ZH) */
  definition: string
  example?: string
}

/** Canonical dictionary record — pure data, no UI/bookkeeping */
export type WordEntry = {
  /** Normalized lowercase lemma, e.g. "resilient" */
  word: string
  /** Display form incl. slashes if available, else "" */
  phonetic: string
  /** https mp3 from dictionaryapi.dev when present */
  audioUrl?: string
  /** At least one after a successful map; empty = invalid entry */
  meanings: WordMeaning[]
  source: WordSource
}

/** Wordbook row = entry + local metadata */
export type WordbookItem = WordEntry & {
  /** Stable id: normalized word (unique in v1) */
  id: string
  /** ISO-8601 */
  addedAt: string
}

export type LookupStatus = 'idle' | 'loading' | 'success' | 'empty' | 'error'

export type LookupErrorCode =
  | 'network'
  | 'http'
  | 'parse'
  | 'invalid-query'
  | 'unknown'

export type LookupResult =
  | { status: 'success'; entry: WordEntry }
  | { status: 'empty'; query: string }
  | { status: 'error'; query: string; message: string; code: LookupErrorCode }

/** Flashcard session (ephemeral, page-local) */
export type FlashcardVerdict = 'know' | 'unknown'

/** Dictation session (ephemeral, page-local) */
export type DictationGrade = 'correct' | 'incorrect'

export type DictationAnswer = {
  itemId: string
  word: string
  given: string
  grade: DictationGrade
}
