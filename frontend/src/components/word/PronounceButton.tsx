import { usePronounce } from '../../hooks/usePronounce'
import { IconButton } from '../ui/IconButton'

export type PronounceButtonProps = {
  word: string
  audioUrl?: string
  /** Slower default suits dictation */
  rate?: number
  /** Extra accessible context, e.g. "播放 resilient 的发音" */
  label?: string
}

function SpeakerGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 9.5v5h3.5L12 19V5L7.5 9.5H4Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M15 9.2a4 4 0 0 1 0 5.6M17.6 6.8a7.4 7.4 0 0 1 0 10.4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function PronounceButton({ word, audioUrl, rate, label }: PronounceButtonProps) {
  const { pronounce, state, statusText } = usePronounce(word, audioUrl, rate)

  return (
    <span className="pronounce">
      <IconButton
        label={label ?? `播放 ${word} 的发音`}
        onClick={pronounce}
        disabled={state === 'playing'}
      >
        <SpeakerGlyph />
      </IconButton>
      <span className="sr-only" aria-live="polite">
        {statusText}
      </span>
    </span>
  )
}
