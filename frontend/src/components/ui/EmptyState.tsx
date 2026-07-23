import type { ReactNode } from 'react'

export type EmptyStateProps = {
  title: string
  body: string
  action?: ReactNode
}

/** Three quiet lines and one action — no illustration. */
export function EmptyState({ title, body, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <h2 className="empty-state-title">{title}</h2>
      <p className="empty-state-body">{body}</p>
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  )
}
