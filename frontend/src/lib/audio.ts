/**
 * Play a recorded pronunciation (dictionaryapi.dev mp3).
 * Returns a cleanup function that stops playback.
 */
export function playAudioUrl(
  url: string,
  onError: () => void,
  onEnded?: () => void,
): () => void {
  const audio = new Audio(url)
  // Tearing the element down (src reset, pause during play()) fires the same
  // error/rejection paths as a real failure; the flag keeps stale callbacks out.
  let stopped = false
  audio.preload = 'auto'
  audio.onerror = () => {
    if (!stopped) onError()
  }
  audio.onended = () => {
    if (!stopped) onEnded?.()
  }

  const playAttempt = audio.play()
  if (playAttempt) {
    playAttempt.catch(() => {
      if (!stopped) onError()
    })
  }

  return () => {
    stopped = true
    audio.onerror = null
    audio.onended = null
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
  }
}
