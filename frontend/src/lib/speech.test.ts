import { describe, expect, it } from 'vitest'
import { normalizeSpokenEnglish, preferredEnglishVoice } from './speech'

function voice(lang: string, localService: boolean, name = lang): SpeechSynthesisVoice {
  return {
    default: false,
    lang,
    localService,
    name,
    voiceURI: name,
  }
}

describe('preferred English voice', () => {
  it('prefers an exact locale local voice', () => {
    const remote = voice('en-US', false, 'remote US')
    const local = voice('en-us', true, 'local US')

    expect(preferredEnglishVoice([remote, local], 'us')).toBe(local)
  })

  it('uses an exact locale remote voice when no local voice exists', () => {
    const remote = voice('en-GB', false, 'remote GB')

    expect(preferredEnglishVoice([remote], 'gb')).toBe(remote)
  })

  it('normalizes underscores in an exact locale', () => {
    const local = voice('en_US', true, 'local US')

    expect(preferredEnglishVoice([local], 'us')).toBe(local)
  })

  it('does not bind an opposite or generic English voice', () => {
    const opposite = voice('en-GB', true, 'local GB')
    const generic = voice('en', true, 'generic English')

    expect(preferredEnglishVoice([opposite, generic], 'us')).toBeUndefined()
  })
})

describe('spoken English normalization', () => {
  it('removes non-audible headword notation from imported phrases', () => {
    expect(normalizeSpokenEnglish('initial public offering (ipo)')).toBe('initial public offering')
    expect(normalizeSpokenEnglish('research and development (r&d)')).toBe('research and development')
    expect(normalizeSpokenEnglish('provide sb. with ...')).toBe('provide sb with')
    expect(normalizeSpokenEnglish('state-owned enterprise')).toBe('state owned enterprise')
  })
})
