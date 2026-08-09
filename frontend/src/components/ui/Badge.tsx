import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

export type BadgeProps = {
  tone?: 'blue' | 'ink' | 'paper'
  children: ReactNode
}

/** Dictionary-style POS / meta tag. */
export function Badge({ tone = 'blue', children }: BadgeProps) {
  return <span className={cn('badge', `badge-${tone}`)}>{children}</span>
}

/** Abbreviate part-of-speech per dictionary convention: adjective → adj. */
const POS_ABBREVIATIONS: Record<string, string> = {
  noun: 'n.',
  verb: 'v.',
  adjective: 'adj.',
  adverb: 'adv.',
  preposition: 'prep.',
  conjunction: 'conj.',
  pronoun: 'pron.',
  determiner: 'det.',
  exclamation: 'excl.',
  interjection: 'excl.',
  numeral: 'num.',
  article: 'art.',
  unknown: '暂无',
}

export function PosBadge({ pos }: { pos: string }) {
  const label = POS_ABBREVIATIONS[pos.toLowerCase()] ?? `${pos}.`
  return <Badge tone="blue">{label}</Badge>
}
