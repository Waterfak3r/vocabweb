import { useMemo, type CSSProperties } from 'react'
import type { AccountStudyProfile } from '../../data/workspaceApi'

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']

type CalendarDay = {
  date: Date
  key: string
  count: number
  level: number
  outside: boolean
}

function parseDateKey(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  if (
    Number.isNaN(date.getTime())
    || date.getFullYear() !== Number(match[1])
    || date.getMonth() !== Number(match[2]) - 1
    || date.getDate() !== Number(match[3])
  ) return null
  date.setHours(0, 0, 0, 0)
  return date
}

function dateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addDays(date: Date, amount: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + amount)
  return next
}

function mondayFor(date: Date) {
  const monday = new Date(date)
  const day = monday.getDay() || 7
  monday.setDate(monday.getDate() - day + 1)
  monday.setHours(0, 0, 0, 0)
  return monday
}

function daysBetween(start: Date, end: Date) {
  return Math.round((end.getTime() - start.getTime()) / 86_400_000)
}

function formatDate(date: Date | null) {
  if (!date) return '日期未知'
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(date)
}

function formatMonth(date: Date) {
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric' }).format(date).replace('月', '') + '月'
}

function activityLevel(count: number, maximum: number) {
  if (count <= 0 || maximum <= 0) return 0
  return Math.min(4, Math.max(1, Math.ceil((count / maximum) * 4)))
}

function buildCalendar(profile: Pick<AccountStudyProfile, 'activityWindow' | 'activity'>) {
  const start = parseDateKey(profile.activityWindow.startDate)
  const end = parseDateKey(profile.activityWindow.endDate)
  if (!start || !end || end < start) return null

  const counts = new Map<string, number>()
  for (const item of profile.activity) {
    const key = item.date.slice(0, 10)
    if (
      /^\d{4}-\d{2}-\d{2}$/.test(key)
      && key >= dateKey(start)
      && key <= dateKey(end)
    ) counts.set(key, (counts.get(key) ?? 0) + Math.max(0, item.count))
  }
  const maximum = Math.max(0, ...counts.values())
  const firstMonday = mondayFor(start)
  const lastSunday = addDays(mondayFor(end), 6)
  const weekCount = Math.max(1, Math.ceil((daysBetween(firstMonday, lastSunday) + 1) / 7))
  const weeks: CalendarDay[][] = []

  for (let week = 0; week < weekCount; week += 1) {
    const weekStart = addDays(firstMonday, week * 7)
    weeks.push(Array.from({ length: 7 }, (_, weekday) => {
      const date = addDays(weekStart, weekday)
      const key = dateKey(date)
      const count = counts.get(key) ?? 0
      return {
        date,
        key,
        count,
        level: activityLevel(count, maximum),
        outside: date < start || date > end,
      }
    }))
  }

  const months = weeks.map((week, index) => {
    const firstOfMonth = week.find((day) => !day.outside && day.date.getDate() === 1)
    if (firstOfMonth || index === 0) return formatMonth(firstOfMonth?.date ?? start)
    return ''
  })

  return { start, end, weeks, months, maximum }
}

export type AccountActivityHeatmapProps = {
  profile: Pick<AccountStudyProfile, 'activityWindow' | 'activity'> | null
  loading: boolean
  error: string
  onRetry: () => void
  showError?: boolean
}

export function AccountActivityHeatmap({ profile, loading, error, onRetry, showError = true }: AccountActivityHeatmapProps) {
  const calendar = useMemo(() => (profile ? buildCalendar(profile) : null), [profile])
  const rangeDays = profile?.activityWindow.days ?? 90
  const rangeLabel = `近 ${rangeDays} 天`

  return (
    <section className="account-activity" aria-labelledby="account-activity-title">
      <header className="account-block-heading">
        <div>
          <h2 id="account-activity-title">学习活跃度</h2>
          <p>{rangeLabel}</p>
        </div>
        {calendar && (
          <p className="account-activity-range" title={`${formatDate(calendar.start)} 至 ${formatDate(calendar.end)}`}>
            {formatDate(calendar.start)} 至 {formatDate(calendar.end)}
          </p>
        )}
      </header>

      {loading ? (
        <div className="account-heatmap-loading" role="status" aria-label="正在加载学习活跃度">
          {Array.from({ length: 7 * 14 }, (_, index) => <span key={index} />)}
        </div>
      ) : !showError && error ? (
        <div className="account-profile-dependent" aria-hidden="true" />
      ) : error || !calendar ? (
        <div className="account-profile-error account-activity-error">
          <p role="alert">{error || '学习活跃度暂时无法加载。'}</p>
          <button type="button" onClick={onRetry}>重试</button>
        </div>
      ) : (
        <>
          <div className="account-heatmap-scroll" tabIndex={0} aria-label={`${rangeLabel}学习活跃度，可横向滚动查看`}>
            <div className="account-heatmap-canvas">
              <div className="account-heatmap-body">
                <div className="account-weekday-labels" aria-hidden="true">
                  {WEEKDAY_LABELS.map((label) => <span key={label}>{label}</span>)}
                </div>
                <div
                  className="account-heatmap-grid"
                  style={{ '--heatmap-columns': calendar.weeks.length } as CSSProperties}
                  aria-label={`${rangeLabel}每日活跃词数`}
                >
                  {WEEKDAY_LABELS.map((_, weekday) => calendar.weeks.map((week) => {
                    const day = week[weekday]
                    return day.outside ? (
                      <span key={`${day.key}-outside`} className="account-heatmap-cell is-outside" aria-hidden="true" />
                    ) : (
                      <span
                        key={day.key}
                        className="account-heatmap-cell"
                        data-level={day.level}
                        role="img"
                        title={`${formatDate(day.date)}，活跃 ${day.count} 个词`}
                        aria-label={`${formatDate(day.date)}，活跃 ${day.count} 个词`}
                      />
                    )
                  }))}
                </div>
              </div>
              <div className="account-heatmap-months" style={{ '--heatmap-columns': calendar.weeks.length } as CSSProperties} aria-hidden="true">
                {calendar.months.map((month, index) => <span key={`${month}-${index}`}>{month}</span>)}
              </div>
            </div>
          </div>
          <footer className="account-heatmap-footer">
            <p>{calendar.maximum === 0 ? `${rangeLabel}还没有学习记录。` : `窗口内最高一天活跃 ${calendar.maximum} 个词。`}</p>
            <div className="account-heatmap-legend" aria-label="活跃度图例">
              <span>少</span>
              {[0, 1, 2, 3, 4].map((level) => <i key={level} data-level={level} aria-hidden="true" />)}
              <span>多</span>
            </div>
          </footer>
        </>
      )}
    </section>
  )
}
