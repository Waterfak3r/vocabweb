import { describe, expect, it } from 'vitest'
import { clearBrowserPreferences, STUDY_CLIENT_ID_STORAGE_KEY } from './privacyStorage'

class MemoryStorage {
  private readonly values = new Map<string, string>()
  get length() { return this.values.size }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
  getItem(key: string) { return this.values.get(key) ?? null }
}

describe('clearBrowserPreferences', () => {
  it('preserves the anonymous data identity while clearing app preferences', () => {
    const storage = new MemoryStorage()
    storage.setItem(STUDY_CLIENT_ID_STORAGE_KEY, 'anonymous-client')
    storage.setItem('vocab-ielts:theme:v1', 'dark')
    storage.setItem('vocab-message-nickname-v1', '访客')
    storage.setItem('unrelated', 'keep')

    clearBrowserPreferences(storage)

    expect(storage.getItem(STUDY_CLIENT_ID_STORAGE_KEY)).toBe('anonymous-client')
    expect(storage.getItem('vocab-ielts:theme:v1')).toBeNull()
    expect(storage.getItem('vocab-message-nickname-v1')).toBeNull()
    expect(storage.getItem('unrelated')).toBe('keep')
  })
})
