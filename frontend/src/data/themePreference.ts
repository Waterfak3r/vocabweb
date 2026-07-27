import { readStorageString, storageKey, writeStorage, type StorageLike } from '../lib/storage'

export type Theme = 'light' | 'dark'

const THEME_KEY = storageKey('theme', 1)

const THEME_COLORS: Record<Theme, string> = {
  light: '#f3ede3',
  dark: '#0c1622',
}

/** Light is always the default; the system preference is intentionally ignored. */
export function readTheme(storage: StorageLike = window.localStorage): Theme {
  return readStorageString(THEME_KEY, storage) === 'dark' ? 'dark' : 'light'
}

export function writeTheme(
  theme: Theme,
  storage: StorageLike = window.localStorage,
): boolean {
  return writeStorage(THEME_KEY, theme, storage)
}

export function themeColorMeta(theme: Theme): string {
  return THEME_COLORS[theme]
}
