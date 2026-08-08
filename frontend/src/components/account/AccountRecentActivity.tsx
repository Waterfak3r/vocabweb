import type { AccountStudyProfile } from '../../data/workspaceApi'

type RecentActivity = AccountStudyProfile['recentActivity'][number]

function formatOccurredAt(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间未知'
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function verdictLabel(verdict: RecentActivity['verdict']) {
  if (verdict === 'know') return '认识'
  if (verdict === 'vague') return '模糊'
  if (verdict === 'unknown') return '不认识'
  return ''
}

function levelLabel(level: number | undefined) {
  if (level === undefined) return ''
  return `等级 ${level}`
}

function activityDescription(item: RecentActivity) {
  const word = `“${item.word}”`
  switch (item.kind) {
    case 'new':
      return `学习新词 ${word}`
    case 'flashcard': {
      const verdict = verdictLabel(item.verdict)
      return verdict ? `复习 ${word}，自评${verdict}` : `复习 ${word}`
    }
    case 'dictation':
      return item.correct === undefined
        ? `完成听写 ${word}`
        : `${item.correct ? '听写答对' : '听写未答对'} ${word}`
    case 'mark': {
      const level = levelLabel(item.levelAfter ?? item.level)
      return level ? `手动调整 ${word}，${level}` : `手动调整 ${word} 的熟练度`
    }
    default:
      return `学习 ${word}`
  }
}

function activityKindLabel(kind: RecentActivity['kind']) {
  if (kind === 'new') return '新词'
  if (kind === 'flashcard') return '闪卡'
  if (kind === 'dictation') return '听写'
  return '标记'
}

export type AccountRecentActivityProps = {
  items: AccountStudyProfile['recentActivity'] | null
  loading: boolean
  error: string
  onRetry: () => void
  showError?: boolean
}

export function AccountRecentActivity({ items, loading, error, onRetry, showError = true }: AccountRecentActivityProps) {
  const visibleItems = items?.slice(0, 8) ?? []

  return (
    <section className="account-recent" aria-labelledby="account-recent-title">
      <header className="account-block-heading">
        <div>
          <h2 id="account-recent-title">最近学习</h2>
          <p>最多显示 8 条记录</p>
        </div>
      </header>

      {loading ? (
        <div className="account-recent-list account-recent-loading" role="status" aria-label="正在加载最近学习">
          {Array.from({ length: 4 }, (_, index) => <span key={index} />)}
        </div>
      ) : !showError && error ? (
        <div className="account-profile-dependent" aria-hidden="true" />
      ) : error ? (
        <div className="account-profile-error">
          <p role="alert">{error}</p>
          <button type="button" onClick={onRetry}>重试</button>
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="account-recent-empty">
          <h3>还没有学习记录</h3>
          <p>完成一次新词、闪卡或听写练习后，记录会显示在这里。</p>
        </div>
      ) : (
        <ol className="account-recent-list">
          {visibleItems.map((item) => (
            <li key={item.id} className="account-recent-item">
              <span className="account-recent-kind" aria-hidden="true">{activityKindLabel(item.kind)}</span>
              <div className="account-recent-copy">
                <p>{activityDescription(item)}</p>
                <small>{item.wordbookTitle || '未命名词书'}</small>
              </div>
              <time dateTime={item.occurredAt}>{formatOccurredAt(item.occurredAt)}</time>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
