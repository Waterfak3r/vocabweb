import { useEffect } from 'react'
import { matchShortcut, type Shortcut } from '../lib/keyboard'

/**
 * Register page-level keyboard shortcuts.
 * Shortcuts are ignored while the user is typing in an input,
 * unless a shortcut sets allowInInput.
 */
export function useKeyboardShortcuts(
  shortcuts: Array<Shortcut & { allowInInput?: boolean }>,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled) return

    const handler = (event: KeyboardEvent) => {
      matchShortcut(event, shortcuts)
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [shortcuts, enabled])
}
