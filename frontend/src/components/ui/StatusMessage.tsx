export type StatusMessageProps = {
  children: string
  live?: 'polite' | 'assertive'
}

/** Quiet status line next to the action it describes; screen-reader live region. */
export function StatusMessage({ children, live = 'polite' }: StatusMessageProps) {
  return (
    <p className="status-message" aria-live={live}>
      {children}
    </p>
  )
}
