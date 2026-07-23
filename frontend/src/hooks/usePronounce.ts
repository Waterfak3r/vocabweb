import { useCallback, useEffect, useRef, useState } from 'react'
import { playAudioUrl } from '../lib/audio'
import { speakEnglishWord } from '../lib/speech'

export type PronounceState = 'idle' | 'playing' | 'unavailable'

/**
 * Pronounce a word: prefer the recorded audioUrl, fall back to
 * Web Speech (en-GB). `statusText` is meant for an aria-live region.
 */
export function usePronounce(word: string, audioUrl?: string, rate = 0.85) {
  const [state, setState] = useState<PronounceState>('idle')
  const [statusText, setStatusText] = useState('')
  const cleanupRef = useRef<(() => void) | null>(null)

  const stop = useCallback(() => {
    cleanupRef.current?.()
    cleanupRef.current = null
    setState('idle')
  }, [])

  const pronounce = useCallback(() => {
    stop()
    setState('playing')
    setStatusText(`正在播放 ${word} 的发音。`)

    const fallbackToSpeech = () => {
      cleanupRef.current = speakEnglishWord(
        word,
        (status) => {
          if (status.kind === 'unavailable' || status.kind === 'failed') {
            setState('unavailable')
            setStatusText('当前浏览器无法朗读，请看音标。')
          } else if (status.kind === 'done') {
            setState('idle')
            setStatusText(`${word} 的发音播放完成。`)
          }
        },
        rate,
      )
    }

    if (audioUrl) {
      cleanupRef.current = playAudioUrl(audioUrl, fallbackToSpeech)
      // Recorded clips are short; return to idle without a status change.
      const timer = window.setTimeout(() => setState('idle'), 4000)
      const previousCleanup = cleanupRef.current
      cleanupRef.current = () => {
        window.clearTimeout(timer)
        previousCleanup()
      }
    } else {
      fallbackToSpeech()
    }
  }, [word, audioUrl, rate, stop])

  useEffect(() => stop, [stop])

  return { pronounce, state, statusText, stop }
}
