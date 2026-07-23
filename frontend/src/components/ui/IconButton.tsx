import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/cn'

export type IconButtonProps = {
  /** Required accessible name */
  label: string
  children: ReactNode
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'aria-label'>

export function IconButton({ label, children, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button type={type} className={cn('icon-btn')} aria-label={label} title={label} {...rest}>
      {children}
    </button>
  )
}
