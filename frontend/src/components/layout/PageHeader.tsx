import type { ReactNode } from 'react'

export type PageHeaderProps = {
  /** Marginal annotation above the title, e.g. "单词本" */
  eyebrow?: string
  title: string
  description?: string
  /** Right-aligned slot, e.g. a count or a link */
  aside?: ReactNode
}

export function PageHeader({ eyebrow, title, description, aside }: PageHeaderProps) {
  return (
    <div className="page-header">
      <div className="page-header-row">
        <div>
          {eyebrow && <p className="marginal">{eyebrow}</p>}
          <h1 className="page-title">{title}</h1>
        </div>
        {aside && <div className="page-header-aside">{aside}</div>}
      </div>
      {description && <p className="page-description">{description}</p>}
      <hr className="ink-rule" />
    </div>
  )
}
