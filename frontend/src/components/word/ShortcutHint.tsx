export type ShortcutHintProps = {
  shortcuts: Array<{ keys: string; action: string }>
}

/** Subtle kbd legend for the current page. */
export function ShortcutHint({ shortcuts }: ShortcutHintProps) {
  return (
    <p className="shortcut-hint">
      {shortcuts.map(({ keys, action }) => (
        <span className="shortcut-hint-item" key={keys}>
          <kbd>{keys}</kbd> {action}
        </span>
      ))}
    </p>
  )
}
