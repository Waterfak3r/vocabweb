import { afterEach, describe, expect, it, vi } from 'vitest'
import { meaningChoiceShortcutIndex, usesOnScreenKeyboard } from './keyboard'

describe('meaningChoiceShortcutIndex', () => {
  it('maps number and letter keys onto the four options', () => {
    expect([1, 2, 3, 4].map((key) => meaningChoiceShortcutIndex(String(key)))).toEqual([0, 1, 2, 3])
    expect(['a', 'B', 'c', 'D'].map(meaningChoiceShortcutIndex)).toEqual([0, 1, 2, 3])
  })

  it('ignores unrelated keys', () => {
    expect(meaningChoiceShortcutIndex('e')).toBeNull()
    expect(meaningChoiceShortcutIndex('enter')).toBeNull()
    expect(meaningChoiceShortcutIndex('0')).toBeNull()
  })
})


function stubMatchMedia(matches: (query: string) => boolean) {
  vi.stubGlobal('window', {
    matchMedia: (query: string) => ({
      matches: matches(query),
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }),
  })
}

describe('usesOnScreenKeyboard', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is false on a fine pointer (desktop mouse)', () => {
    stubMatchMedia(() => false)
    expect(usesOnScreenKeyboard()).toBe(false)
  })

  it('is true on a coarse pointer (phone or tablet)', () => {
    stubMatchMedia((query) => query.includes('(pointer: coarse)'))
    expect(usesOnScreenKeyboard()).toBe(true)
  })
})
