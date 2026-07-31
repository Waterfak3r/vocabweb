/** Provenance of definition data */
export type WordSource = 'local-ielts' | 'dictionary-api' | 'user' | 'backend'

export type WordMeaning = {
  /** Part of speech, lowercase display form, e.g. "adjective" */
  pos: string
  /** English gloss (dictionary data stays EN; UI chrome is ZH) */
  definition: string
  example?: string
  sourceId?: 'open_english_wordnet' | 'wiktionary' | 'wiktapi'
}

/** Canonical dictionary record — pure data, no UI/bookkeeping */
export type WordEntry = {
  /** Normalized lowercase lemma, e.g. "resilient" */
  word: string
  /** Display form incl. slashes if available, else "" */
  phonetic: string
  /** https mp3 from dictionaryapi.dev when present */
  audioUrl?: string
  /** May be empty for a learner-kept word that no dictionary source matched. */
  meanings: WordMeaning[]
  /** Chinese learner meaning, kept separate from English dictionary glosses. */
  zhMeaning?: string
  /** User meanings take precedence over dictionary-provided Chinese text. */
  zhMeaningSource?: 'user' | 'dictionary'
  availableLanguages?: Array<'zh' | 'en'>
  sources?: Array<{
    id: 'open_english_wordnet' | 'ecdict' | 'wiktionary' | 'wiktapi'
    name: string
    version: string
    license: string
    url: string
  }>
  source: WordSource
}

/** Wordbook row = entry + local metadata */
export type WordbookItem = WordEntry & {
  /** Stable UUID; changing the headword must not change this id. */
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
  skipped?: true
}
