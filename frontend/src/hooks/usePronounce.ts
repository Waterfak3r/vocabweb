import { useCallback, useEffect, useRef, useState } from 'react'
import { recordedPronunciationAudioUrl } from '../data/recordedPronunciation'
import { readPronunciationPreferences, type EnglishAccent } from '../data/pronunciationPreferences'
import { playAudioUrl } from '../lib/audio'
import { normalizeSpokenEnglish, speakEnglishWord } from '../lib/speech'

export type PronounceState = 'idle' | 'playing' | 'unavailable'

/**
 * Pronounce a word: prefer the selected-accent recording, then fall back to
 * Web Speech in the same accent. `statusText` is meant for an aria-live region.
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
        (failure) => {
          window.clearTimeout(timer)
          stopAudio()
          if (failure === 'blocked') {
            // Autoplay without a fresh gesture is restricted on mobile. Do not
            // replace the recording with an OS-specific voice; leave playback
            // ready for the learner's next tap instead.
            setState('idle')
            setStatusText('浏览器阻止了自动播放，请点击发音按钮。')
            return
          }
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

    // Start the media request synchronously inside the user's click/shortcut.
    // Awaiting the pronunciation metadata first loses transient user activation
    // on mobile Safari/Chrome, which rejects the recording and falls back to a
    // device-specific system voice.
    const recordingUrl = recordedPronunciationAudioUrl(normalizeSpokenEnglish(word), accent)
    if (recordingUrl) playRecording(recordingUrl)
    else fallbackToSpeech()
  }, [word, rate, accent, stop])

  useEffect(() => stop, [stop])

  return { pronounce, state, statusText, stop }
}
