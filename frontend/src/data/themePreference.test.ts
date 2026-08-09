import { describe, expect, it } from 'vitest'
import {
  DEFAULT_QUICK_THEMES,
  nextQuickTheme,
  readQuickThemes,
  readTheme,
  themeColorMeta,
  writeQuickThemes,
  writeTheme,
} from './themePreference'

class MemoryStorage {
  private readonly values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}

const THEME_KEY = 'vocab-ielts:theme:v1'
const QUICK_THEMES_KEY = 'vocab-ielts:theme-quick-switch:v1'

describe('themePreference', () => {
  it('defaults to paper and reads all named styles', () => {
    const storage = new MemoryStorage()
    expect(readTheme(storage)).toBe('paper')
    for (const theme of ['paper', 'graphite', 'dusk', 'city-pop', 'classic-light', 'classic-dark'] as const) {
      storage.setItem(THEME_KEY, JSON.stringify(theme))
      expect(readTheme(storage)).toBe(theme)
    }
  })

  it('maps the legacy light and dark values to their restored palettes', () => {
    const storage = new MemoryStorage()
    storage.setItem(THEME_KEY, JSON.stringify('dark'))
    expect(readTheme(storage)).toBe('classic-dark')
    storage.setItem(THEME_KEY, JSON.stringify('light'))
    expect(readTheme(storage)).toBe('classic-light')
  })

  it('persists a selected style and exposes matching browser colors', () => {
    const storage = new MemoryStorage()
    expect(writeTheme('graphite', storage)).toBe(true)
    expect(storage.getItem(THEME_KEY)).toBe(JSON.stringify('graphite'))
    expect(themeColorMeta('paper')).toBe('#f1eee7')
    expect(themeColorMeta('graphite')).toBe('#191916')
    expect(themeColorMeta('dusk')).toBe('#211821')
    expect(themeColorMeta('city-pop')).toBe('#101b35')
    expect(themeColorMeta('classic-light')).toBe('#fdf9f4')
    expect(themeColorMeta('classic-dark')).toBe('#0c1622')
  })

  it('persists two distinct quick-switch styles and rejects invalid pairs', () => {
    const storage = new MemoryStorage()
    expect(readQuickThemes(storage)).toEqual(DEFAULT_QUICK_THEMES)
    expect(writeQuickThemes(['dusk', 'city-pop'], storage)).toBe(true)
    expect(storage.getItem(QUICK_THEMES_KEY)).toBe(JSON.stringify(['dusk', 'city-pop']))
    expect(readQuickThemes(storage)).toEqual(['dusk', 'city-pop'])

    storage.setItem(QUICK_THEMES_KEY, JSON.stringify(['paper', 'paper']))
    expect(readQuickThemes(storage)).toEqual(DEFAULT_QUICK_THEMES)
  })

  it('toggles only between the configured quick-switch pair', () => {
    const quickThemes = ['dusk', 'city-pop'] as const
    expect(nextQuickTheme('dusk', quickThemes)).toBe('city-pop')
    expect(nextQuickTheme('city-pop', quickThemes)).toBe('dusk')
    expect(nextQuickTheme('paper', quickThemes)).toBe('dusk')
  })
})
