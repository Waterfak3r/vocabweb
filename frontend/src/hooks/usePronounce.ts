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
      let timer = 0
      const stopAudio = playAudioUrl(
        audioUrl,
        () => {
          window.clearTimeout(timer)
          stopAudio()
          fallbackToSpeech()
          // Speech can be cancelled without a terminal callback (another player
          // calls the global cancel); keep a watchdog so state cannot stick at
          // 'playing', and keep the speech cleanup reachable from stop().
          const speechCleanup = cleanupRef.current
          timer = window.setTimeout(() => setState('idle'), 8000)
          cleanupRef.current = () => {
            window.clearTimeout(timer)
            speechCleanup?.()
          }
        },
        () => {
          setState('idle')
          setStatusText(`${word} 的发音播放完成。`)
        },
      )
      // Fallback for clips that never fire `ended` (stalled streams).
      timer = window.setTimeout(() => setState('idle'), 4000)
      cleanupRef.current = () => {
        window.clearTimeout(timer)
        stopAudio()
      }
    } else {
      fallbackToSpeech()
    }
  }, [word, audioUrl, rate, stop])

  useEffect(() => stop, [stop])

  return { pronounce, state, statusText, stop }
}
