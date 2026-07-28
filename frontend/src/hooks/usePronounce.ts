import { useCallback, useEffect, useRef, useState } from 'react'
import { getRecordedPronunciation } from '../data/recordedPronunciation'
import { readPronunciationPreferences, type EnglishAccent } from '../data/pronunciationPreferences'
import { playAudioUrl } from '../lib/audio'
import { normalizeSpokenEnglish, speakEnglishWord } from '../lib/speech'

export type PronounceState = 'idle' | 'playing' | 'unavailable'

/**
 * Pronounce a word: prefer the recorded audioUrl, fall back to
 * Web Speech (en-GB). `statusText` is meant for an aria-live region.
 */
export function usePronounce(word: string, rate = 0.85, requestedAccent?: EnglishAccent) {
  const accent = requestedAccent ?? readPronunciationPreferences().accent
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
        accent,
      )
    }

    const playRecording = (recordingUrl: string) => {
      let timer = 0
      const stopAudio = playAudioUrl(
        recordingUrl,
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
    }

    // Stored wordbook audio predates the accent preference and has no reliable
    // accent metadata. Resolve the selected accent through the dedicated route
    // so changing the setting cannot keep playing a stale opposite-accent clip.
    let cancelled = false
    cleanupRef.current = () => { cancelled = true }
    void getRecordedPronunciation(normalizeSpokenEnglish(word), accent).then((pronunciation) => {
      if (cancelled) return
      if (pronunciation?.audioUrl) playRecording(pronunciation.audioUrl)
      else fallbackToSpeech()
    })
  }, [word, rate, accent, stop])

  useEffect(() => stop, [stop])

  return { pronounce, state, statusText, stop }
}
