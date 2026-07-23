import { isValidWordQuery, normalizeWord } from '../domain/normalize'
import type { WordEntry, WordMeaning } from '../domain/types'
import { LookupError, type WordRepository } from './wordRepository'

/* ── Raw dictionaryapi.dev shapes (boundary only — never leak to UI) ── */

type DictionaryApiPhonetic = {
  text?: string
  audio?: string
  sourceUrl?: string
}

type DictionaryApiDefinition = {
  definition: string
  example?: string
  synonyms?: string[]
  antonyms?: string[]
}

type DictionaryApiMeaning = {
  partOfSpeech: string
  definitions: DictionaryApiDefinition[]
}

type DictionaryApiEntry = {
  word: string
  phonetic?: string
  phonetics?: DictionaryApiPhonetic[]
  meanings?: DictionaryApiMeaning[]
}

const MAX_MEANINGS = 8

/**
 * Map the API payload to a canonical WordEntry.
 * Returns null when the payload has no usable lemma or glosses.
 */
export function mapDictionaryApiToWordEntry(
  data: DictionaryApiEntry[],
): WordEntry | null {
  const primary = data[0]
  if (!primary) return null

  const word = normalizeWord(primary.word ?? '')
  if (!isValidWordQuery(word)) return null

  const phonetic =
    (primary.phonetic && primary.phonetic.trim()) ||
    (primary.phonetics ?? []).find((p) => p.text?.trim())?.text?.trim() ||
    ''

  const audioCandidates = (primary.phonetics ?? [])
    .map((p) => p.audio?.trim())
    .filter((audio): audio is string => Boolean(audio))
  const audioUrl =
    audioCandidates.find((audio) => audio.includes('en-gb')) ?? audioCandidates[0]

  const meanings: WordMeaning[] = (primary.meanings ?? [])
    .flatMap((meaning) =>
      meaning.definitions.map((definition) => ({
        pos: (meaning.partOfSpeech || 'unknown').toLowerCase(),
        definition: definition.definition.trim(),
        example: definition.example?.trim() || undefined,
      })),
    )
    .filter((meaning) => meaning.definition.length > 0)
    .slice(0, MAX_MEANINGS)

  if (meanings.length === 0) return null

  return { word, phonetic, audioUrl, meanings, source: 'dictionary-api' }
}

export type DictionaryApiRepositoryOptions = {
  baseUrl: string
  /** ms before the request is aborted; default 8000 */
  timeoutMs?: number
}

/** dictionaryapi.dev — free, keyless EN dictionary. */
export class DictionaryApiRepository implements WordRepository {
  private readonly baseUrl: string
  private readonly timeoutMs: number

  constructor(options: DictionaryApiRepositoryOptions) {
    this.baseUrl = options.baseUrl
    this.timeoutMs = options.timeoutMs ?? 8000
  }

  async lookup(word: string): Promise<WordEntry | null> {
    const query = normalizeWord(word)
    if (!isValidWordQuery(query)) return null

    const url = `${this.baseUrl}/${encodeURIComponent(query)}`

    let response: Response
    try {
      response = await fetch(url, {
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (cause) {
      throw new LookupError('network', '网络请求失败，请检查连接后重试。', { cause })
    }

    if (response.status === 404) return null
    if (!response.ok) {
      throw new LookupError('http', `词典服务暂时不可用（${response.status}）。`)
    }

    let payload: unknown
    try {
      payload = await response.json()
    } catch (cause) {
      throw new LookupError('parse', '词典返回的数据无法解析。', { cause })
    }

    if (!Array.isArray(payload)) return null

    try {
      return mapDictionaryApiToWordEntry(payload as DictionaryApiEntry[])
    } catch (cause) {
      throw new LookupError('parse', '词典返回的数据无法解析。', { cause })
    }
  }
}
