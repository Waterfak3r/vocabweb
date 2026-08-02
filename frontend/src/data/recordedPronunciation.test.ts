import { describe, expect, it, vi } from 'vitest'
import { getRecordedPronunciation, recordedPronunciationAudioUrl } from './recordedPronunciation'

describe('recorded pronunciation lookup', () => {
  it('builds a same-origin playback URL for the selected accent', () => {
    expect(recordedPronunciationAudioUrl('STATE', 'us')).toBe('/api/pronunciations/state/audio?accent=us')
    expect(recordedPronunciationAudioUrl('state?', 'gb')).toBeNull()
  })

  it('loads and caches an HTTPS recording', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      phonetic: '/steɪt/',
      audioUrl: 'https://audio.example/en-gb/state.mp3',
    }), { status: 200, headers: { 'content-type': 'application/json' } }))

    await expect(getRecordedPronunciation('state', 'gb', fetchFn)).resolves.toEqual({
      phonetic: '/steɪt/',
      audioUrl: 'https://audio.example/en-gb/state.mp3',
    })
    await getRecordedPronunciation('STATE', 'gb', fetchFn)
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(fetchFn).toHaveBeenCalledWith('/api/pronunciations/state?accent=gb', expect.anything())
  })

  it('rejects unsafe recording URLs', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      phonetic: '/test/',
      audioUrl: 'http://audio.example/test.mp3',
    }), { status: 200 }))
    await expect(getRecordedPronunciation('unsafeaudio', 'us', fetchFn)).resolves.toBeNull()
  })
})
