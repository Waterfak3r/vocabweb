import { useCallback, useEffect, useState } from 'react'
import { readTheme, themeColorMeta, writeTheme, type Theme } from '../data/themePreference'

/**
 * Applies the persisted theme to <html data-theme> and the theme-color meta.
 * The pre-paint script in index.html has already set both, so the effect only
 * re-asserts them — no flash on load.
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', themeColorMeta(theme))
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark'
      writeTheme(next)
      return next
    })
  }, [])

  return { theme, toggleTheme }
}
