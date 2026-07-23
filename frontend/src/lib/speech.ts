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

export function speakEnglishWord(
  word: string,
  onStatus: (status: SpeechStatus) => void,
  rate = 0.85,
): () => void {
  if (!isSpeechAvailable()) {
    onStatus({ kind: 'unavailable' })
    return () => {}
  }

  window.speechSynthesis.cancel()

  const utterance = new SpeechSynthesisUtterance(word)
  utterance.lang = 'en-GB'
  utterance.rate = rate
  utterance.onstart = () => onStatus({ kind: 'playing', word })
  utterance.onend = () => onStatus({ kind: 'done', word })
  utterance.onerror = (event) => {
    if (event.error === 'canceled' || event.error === 'interrupted') return
    onStatus({ kind: 'failed' })
  }

  window.speechSynthesis.speak(utterance)

  return () => {
    window.speechSynthesis.cancel()
  }
}

export function cancelSpeech(): void {
  if (isSpeechAvailable()) window.speechSynthesis.cancel()
}
