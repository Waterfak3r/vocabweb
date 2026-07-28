/** True when the event target is a text-entry element. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  )
}

export type Shortcut = {
  /** KeyboardEvent.key, lowercase-compared (e.g. ' ', 'f', '/', 'enter') */
  key: string
  ctrl?: boolean
  action: () => void
}

/**
 * Match a keyboard event against a shortcut list.
 * Short-circuits (preventDefault + run) on first match.
 * Ignores typing targets unless `allowInInput` is set on the shortcut.
 */
export function matchShortcut(
  event: KeyboardEvent,
  shortcuts: Array<Shortcut & { allowInInput?: boolean }>,
): boolean {
  if (event.isComposing || event.altKey || event.shiftKey) return false
  if (isTypingTarget(event.target)) {
    const allowed = shortcuts.find(
      (s) =>
        s.allowInInput &&
        s.key === event.key.toLowerCase() &&
        Boolean(s.ctrl) === (event.ctrlKey || event.metaKey),
    )
    if (!allowed) return false
    event.preventDefault()
    allowed.action()
    return true
  }

  for (const shortcut of shortcuts) {
    const ctrlMatch = Boolean(shortcut.ctrl) === (event.ctrlKey || event.metaKey)
    if (shortcut.key === event.key.toLowerCase() && ctrlMatch) {
      event.preventDefault()
      shortcut.action()
      return true
    }
  }
  return false
}
