import { normalizeWord } from '../domain/normalize'
import type { EnglishAccent } from '../data/pronunciationPreferences'

/**
 * Web Speech API wrapper (en-GB), cancel-safe.
 * Returns a cleanup function; status messages surface via callback
 * for aria-live regions.
 */
export type SpeechStatus =
  | { kind: 'playing'; word: string }
  | { kind: 'done'; word: string }
  | { kind: 'unavailable' }
  | { kind: 'failed' }

export function isSpeechAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof SpeechSynthesisUtterance !== 'undefined'
  )
}

/** Remove headword notation that should not be spoken as part of the phrase. */
export function normalizeSpokenEnglish(value: string): string {
  return normalizeWord(value)
    .replace(/ \((?:[a-z0-9]{2,12}|[a-z0-9]{1,8}(?:[&/-][a-z0-9]{1,8}){1,3})\)$/i, '')
    .replace(/\.{3}/g, ' ')
    .replace(/\./g, '')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function preferredEnglishVoice(voices: SpeechSynthesisVoice[], accent: EnglishAccent): SpeechSynthesisVoice | undefined {
  const language = accent === 'us' ? 'en-us' : 'en-gb'
  const matchesLanguage = (voice: SpeechSynthesisVoice) => voice.lang.toLowerCase().replace(/_/g, '-') === language
  return voices.find((voice) => matchesLanguage(voice) && voice.localService)
    ?? voices.find(matchesLanguage)
}

export function speakEnglishWord(
  word: string,
  onStatus: (status: SpeechStatus) => void,
  rate = 0.85,
  accent: EnglishAccent = 'gb',
): () => void {
  if (!isSpeechAvailable()) {
    onStatus({ kind: 'unavailable' })
    return () => {}
  }

  const speech = window.speechSynthesis
  const spokenWord = normalizeSpokenEnglish(word) || word
  let disposed = false
  let started = false
  let startTimer: number | undefined

  const start = () => {
    if (disposed || started) return
    started = true
    const utterance = new SpeechSynthesisUtterance(spokenWord)
    utterance.lang = accent === 'us' ? 'en-US' : 'en-GB'
    utterance.rate = rate
    const voice = preferredEnglishVoice(speech.getVoices(), accent)
    if (voice) utterance.voice = voice
    utterance.onstart = () => onStatus({ kind: 'playing', word })
    utterance.onend = () => onStatus({ kind: 'done', word })
    utterance.onerror = (event) => {
      if (event.error === 'canceled' || event.error === 'interrupted') return
      onStatus({ kind: 'failed' })
    }
    speech.speak(utterance)
  }

  const onVoicesChanged = () => start()
  speech.cancel()
  speech.addEventListener?.('voiceschanged', onVoicesChanged, { once: true })
  // Chrome may silently drop speak() when it runs in the same task as cancel(),
  // while some systems expose their voices shortly after page load.
  startTimer = window.setTimeout(start, speech.getVoices().length ? 0 : 120)

  return () => {
    disposed = true
    if (startTimer !== undefined) window.clearTimeout(startTimer)
    speech.removeEventListener?.('voiceschanged', onVoicesChanged)
    speech.cancel()
  }
}

export function cancelSpeech(): void {
  if (isSpeechAvailable()) window.speechSynthesis.cancel()
}
