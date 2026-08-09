import { useCallback, useEffect, useState } from 'react'
import {
  isQuickThemes,
  isTheme,
  nextQuickTheme,
  readQuickThemes,
  readTheme,
  themeColorMeta,
  writeQuickThemes,
  writeTheme,
  type QuickThemes,
  type Theme,
} from '../data/themePreference'

const THEME_CHANGE_EVENT = 'vocab:theme-change'
const QUICK_THEMES_CHANGE_EVENT = 'vocab:quick-themes-change'

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', themeColorMeta(theme))
}

/**
 * Applies the persisted theme to <html data-theme> and the theme-color meta.
 * The pre-paint script in index.html has already set both, so the effect only
 * re-asserts them. The custom event keeps the header and account picker in sync.
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readTheme)
  const [quickThemes, setQuickThemes] = useState<QuickThemes>(readQuickThemes)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    const syncTheme = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : undefined
      setTheme(isTheme(detail) ? detail : readTheme())
    }
    const syncQuickThemes = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : undefined
      setQuickThemes(isQuickThemes(detail) ? detail : readQuickThemes())
    }
    const syncStorage = () => {
      setTheme(readTheme())
      setQuickThemes(readQuickThemes())
    }
    window.addEventListener(THEME_CHANGE_EVENT, syncTheme)
    window.addEventListener(QUICK_THEMES_CHANGE_EVENT, syncQuickThemes)
    window.addEventListener('storage', syncStorage)
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, syncTheme)
      window.removeEventListener(QUICK_THEMES_CHANGE_EVENT, syncQuickThemes)
      window.removeEventListener('storage', syncStorage)
    }
  }, [])

  const selectTheme = useCallback((next: Theme) => {
    writeTheme(next)
    applyTheme(next)
    setTheme(next)
    window.dispatchEvent(new CustomEvent<Theme>(THEME_CHANGE_EVENT, { detail: next }))
  }, [])

  const selectQuickThemes = useCallback((next: QuickThemes) => {
    writeQuickThemes(next)
    setQuickThemes(next)
    window.dispatchEvent(new CustomEvent<QuickThemes>(QUICK_THEMES_CHANGE_EVENT, { detail: next }))
  }, [])

  const toggleTheme = useCallback(() => {
    selectTheme(nextQuickTheme(theme, quickThemes))
  }, [quickThemes, selectTheme, theme])

  return { theme, selectTheme, toggleTheme, quickThemes, selectQuickThemes }
}
