import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link, type LinkProps } from 'react-router-dom'
import { cn } from '../../lib/cn'

type ButtonStyleProps = {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  children: ReactNode
}

export type ButtonProps = ButtonStyleProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'>

export function Button({
  variant = 'primary',
  size = 'md',
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button type={type} className={cn('btn', `btn-${variant}`, `btn-${size}`)} {...rest}>
      {children}
    </button>
  )
}

export type ButtonLinkProps = ButtonStyleProps & Omit<LinkProps, 'className'>

/** A router link with button styling, without nesting interactive elements. */
export function ButtonLink({
  variant = 'primary',
  size = 'md',
  children,
  ...rest
}: ButtonLinkProps) {
  return (
    <Link className={cn('btn', `btn-${variant}`, `btn-${size}`)} {...rest}>
      {children}
    </Link>
  )
}
