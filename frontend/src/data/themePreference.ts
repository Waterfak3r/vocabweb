import { readStorage, readStorageString, storageKey, writeStorage, type StorageLike } from '../lib/storage'

export const THEMES = [
  'paper',
  'graphite',
  'dusk',
  'city-pop',
  'classic-light',
  'classic-dark',
] as const

export type Theme = typeof THEMES[number]
export type QuickThemes = readonly [Theme, Theme]

export const THEME_LABELS: Record<Theme, string> = {
  paper: '纸白',
  graphite: '石墨纸',
  dusk: '黄昏',
  'city-pop': 'City Pop',
  'classic-light': '原版白天',
  'classic-dark': '原版黑夜',
}

const THEME_KEY = storageKey('theme', 1)
const QUICK_THEMES_KEY = storageKey('theme-quick-switch', 1)

export const DEFAULT_QUICK_THEMES: QuickThemes = ['paper', 'graphite']

const THEME_COLORS: Record<Theme, string> = {
  paper: '#f1eee7',
  graphite: '#191916',
  dusk: '#211821',
  'city-pop': '#101b35',
  'classic-light': '#fdf9f4',
  'classic-dark': '#0c1622',
}

export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && THEMES.includes(value as Theme)
}

export function isQuickThemes(value: unknown): value is QuickThemes {
  return Array.isArray(value)
    && value.length === 2
    && isTheme(value[0])
    && isTheme(value[1])
    && value[0] !== value[1]
}

/** Legacy light/dark values now map to their restored original palettes. */
export function readTheme(storage: StorageLike = window.localStorage): Theme {
  const saved = readStorageString(THEME_KEY, storage)
  if (saved === 'light') return 'classic-light'
  if (saved === 'dark') return 'classic-dark'
  return isTheme(saved) ? saved : 'paper'
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

export function readQuickThemes(storage: StorageLike = window.localStorage): QuickThemes {
  const saved = readStorage<unknown>(QUICK_THEMES_KEY, storage)
  return isQuickThemes(saved) ? saved : DEFAULT_QUICK_THEMES
}

export function writeQuickThemes(
  themes: QuickThemes,
  storage: StorageLike = window.localStorage,
): boolean {
  return writeStorage(QUICK_THEMES_KEY, themes, storage)
}

export function nextQuickTheme(theme: Theme, quickThemes: QuickThemes): Theme {
  return theme === quickThemes[0] ? quickThemes[1] : quickThemes[0]
}
