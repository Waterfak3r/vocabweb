/**
 * Play a recorded pronunciation URL.
 * Returns a cleanup function that stops playback.
 */
export type AudioPlaybackFailure = 'blocked' | 'failed'

function playbackFailure(error: unknown): AudioPlaybackFailure {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'NotAllowedError'
    ? 'blocked'
    : 'failed'
}

export function playAudioUrl(
  url: string,
  onError: (failure: AudioPlaybackFailure) => void,
  onEnded?: () => void,
): () => void {
  const audio = new Audio(url)
  // Tearing the element down (src reset, pause during play()) fires the same
  // error/rejection paths as a real failure; the flag keeps stale callbacks out.
  let stopped = false
  audio.preload = 'auto'
  audio.onerror = () => {
    if (!stopped) onError('failed')
  }
  audio.onended = () => {
    if (!stopped) onEnded?.()
  }

  const playAttempt = audio.play()
  if (playAttempt) {
    playAttempt.catch((error: unknown) => {
      if (!stopped) onError(playbackFailure(error))
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
