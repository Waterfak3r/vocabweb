import { afterEach, describe, expect, it, vi } from 'vitest'
import { playAudioUrl } from './audio'

describe('recorded audio playback', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reports mobile autoplay restrictions without treating them as a broken recording', async () => {
    class BlockedAudio {
      preload = ''
      onerror: (() => void) | null = null
      onended: (() => void) | null = null

      play() {
        return Promise.reject(new DOMException('Playback requires a user gesture', 'NotAllowedError'))
      }

      pause() {}
      removeAttribute() {}
      load() {}
    }
    vi.stubGlobal('Audio', BlockedAudio)
    const onError = vi.fn()

    playAudioUrl('/api/pronunciations/state/audio?accent=gb', onError)
    await Promise.resolve()

    expect(onError).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith('blocked')
  })
})
