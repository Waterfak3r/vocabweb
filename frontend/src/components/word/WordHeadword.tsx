import { createElement } from 'react'
import type { WordSource } from '../../domain/types'

export type WordHeadwordProps = {
  word: string
  phonetic?: string
  source?: WordSource
  /** Heading level in the document outline */
  as?: 'h1' | 'h2' | 'p'
  /** Compact size for list rows */
  compact?: boolean
}

const SOURCE_LABELS: Record<WordSource, string> = {
  'local-ielts': 'IELTS 精选',
  'dictionary-api': '在线词典',
  user: '自建',
  backend: '词库',
}

/**
 * The signature moment: a serif headword set in ink on paper,
 * with the phonetic whispering alongside in mono.
 */
export function WordHeadword({
  word,
  phonetic,
  source,
  as = 'h2',
  compact = false,
}: WordHeadwordProps) {
  return createElement(
    as,
    { className: compact ? 'headword headword-compact' : 'headword' },
    <span className="headword-word">{word}</span>,
    phonetic && <span className="headword-phonetic">{phonetic}</span>,
    source && <span className="headword-source">{SOURCE_LABELS[source]}</span>,
  )
}
