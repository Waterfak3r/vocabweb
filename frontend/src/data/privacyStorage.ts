import { storageKey } from '../lib/storage'

export const STUDY_CLIENT_ID_STORAGE_KEY = storageKey('client-id', 1)

type BrowserStorage = Pick<Storage, 'key' | 'length' | 'removeItem'>

/** Clears replaceable browser preferences while preserving access to anonymous server data. */
export function clearBrowserPreferences(storage: BrowserStorage): void {
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter((key): key is string => key !== null)
  for (const key of keys) {
    const isAppPreference = key.startsWith('vocab-ielts:')
      || key === 'vocab-message-nickname-v1'
      || key === 'vocab-dictionary-language-v1'
    if (isAppPreference && key !== STUDY_CLIENT_ID_STORAGE_KEY) storage.removeItem(key)
  }
}
