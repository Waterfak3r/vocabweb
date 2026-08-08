import { cn } from '../../lib/cn'

export type UserAvatarProps = {
  username: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
  /** Use when the username is already exposed by nearby text or a control label. */
  decorative?: boolean
}

/**
 * Keeps account identity consistent across the profile hero and the header menu.
 * Array.from is intentional here so emoji and other astral Unicode characters
 * are not split in the middle of a surrogate pair.
 */
export function getUserInitials(username: string) {
  const initials = Array.from(username.trim()).slice(0, 2).join('')
  return initials ? initials.toLocaleUpperCase('zh-CN') : '账'
}

export function UserAvatar({ username, size = 'md', className, decorative = false }: UserAvatarProps) {
  return (
    <span
      className={cn('user-avatar', `user-avatar-${size}`, className)}
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : `${username}头像`}
    >
      {getUserInitials(username)}
    </span>
  )
}
