import { UserAvatar } from './UserAvatar'

export type ContributorAvatarPerson = {
  username: string
  avatarUrl?: string | null
  mergedCount?: number
}

const MAX_VISIBLE = 5

export function ContributorAvatars({
  contributors,
  max = MAX_VISIBLE,
  size = 'sm',
}: {
  contributors: ContributorAvatarPerson[]
  max?: number
  size?: 'sm' | 'md'
}) {
  if (!contributors.length) return null
  const visible = contributors.slice(0, max)
  const extra = contributors.length - visible.length
  return (
    <div className={`contributor-avatars contributor-avatars-${size}`} aria-label={`${contributors.length} 位贡献者`}>
      <ul>
        {visible.map((person, index) => {
          const detail = person.mergedCount
            ? `${person.username} · ${person.mergedCount} 次合并`
            : `${person.username} · 发布者`
          return (
            <li key={`${person.username}-${index}`} title={detail}>
              <UserAvatar username={person.username} avatarUrl={person.avatarUrl} size={size} decorative />
              <span className="sr-only">{detail}</span>
            </li>
          )
        })}
      </ul>
      <span>
        {contributors.length} 位贡献者
        {extra > 0 ? ` · 另有 ${extra} 人` : ''}
      </span>
    </div>
  )
}
