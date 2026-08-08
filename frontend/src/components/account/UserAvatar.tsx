import { useState } from 'react'
import { cn } from '../../lib/cn'

export type UserAvatarProps = {
  username: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
  avatarUrl?: string | null
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

export function UserAvatar({ username, size = 'md', className, avatarUrl, decorative = false }: UserAvatarProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const showImage = Boolean(avatarUrl && failedUrl !== avatarUrl)
  return (
    <span
      className={cn('user-avatar', `user-avatar-${size}`, showImage && 'user-avatar-image', className)}
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : `${username}头像`}
    >
      {showImage ? (
        <img src={avatarUrl ?? undefined} alt="" onError={() => setFailedUrl(avatarUrl ?? null)} />
      ) : getUserInitials(username)}
    </span>
  )
}
