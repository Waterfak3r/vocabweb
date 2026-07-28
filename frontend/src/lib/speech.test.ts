import { describe, expect, it } from 'vitest'
import { normalizeSpokenEnglish } from './speech'

describe('spoken English normalization', () => {
  it('removes non-audible headword notation from imported phrases', () => {
    expect(normalizeSpokenEnglish('initial public offering (ipo)')).toBe('initial public offering')
    expect(normalizeSpokenEnglish('research and development (r&d)')).toBe('research and development')
    expect(normalizeSpokenEnglish('provide sb. with ...')).toBe('provide sb with')
    expect(normalizeSpokenEnglish('state-owned enterprise')).toBe('state owned enterprise')
  })
})
