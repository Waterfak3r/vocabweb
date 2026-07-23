/**
 * Play a recorded pronunciation (dictionaryapi.dev mp3).
 * Returns a cleanup function that stops playback.
 */
export function playAudioUrl(
  url: string,
  onError: () => void,
): () => void {
  const audio = new Audio(url)
  audio.preload = 'auto'
  audio.onerror = onError

  const playAttempt = audio.play()
  if (playAttempt) {
    playAttempt.catch(onError)
  }

  return () => {
    audio.pause()
    audio.src = ''
  }
}
