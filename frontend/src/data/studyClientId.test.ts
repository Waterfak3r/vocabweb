import { afterEach, describe, expect, it, vi } from 'vitest'
import { getStudyClientId, rotateStudyClientId, setStudyClientId } from './studyApi'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value) }),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('study client id rotation', () => {
  it('replaces the account-compatible id with a fresh stable anonymous id', () => {
    const localStorage = memoryStorage()
    vi.stubGlobal('window', { localStorage })
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'anonymous-new') })
    setStudyClientId('account-data-home')

    expect(rotateStudyClientId()).toBe('anonymous-new')
    expect(getStudyClientId()).toBe('anonymous-new')
  })

  it('does not reuse the previous id even if the UUID source repeats once', () => {
    const localStorage = memoryStorage()
    vi.stubGlobal('window', { localStorage })
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn()
        .mockReturnValueOnce('same-id')
        .mockReturnValueOnce('different-id'),
    })
    setStudyClientId('same-id')

    expect(rotateStudyClientId()).toBe('different-id')
    expect(getStudyClientId()).toBe('different-id')
  })
})
