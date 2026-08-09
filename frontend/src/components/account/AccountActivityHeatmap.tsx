import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import type { AccountStudyProfile } from '../../data/workspaceApi'

const ACTIVITY_RANGES = [30, 90] as const
const ACTIVITY_VIEWS = [
  { id: 'daily', label: 'Daily', accessibleLabel: '每日' },
  { id: 'weekly', label: 'Weekly', accessibleLabel: '每周' },
  { id: 'cumulative', label: 'Cumulative', accessibleLabel: '累计' },
] as const
const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']

type ActivityRange = typeof ACTIVITY_RANGES[number]
type ActivityView = typeof ACTIVITY_VIEWS[number]['id']
export type CustomActivityRange = { startDate: string; endDate: string }
type ActivityCalendarRange = ActivityRange | CustomActivityRange
type ActivityRangeSelection =
  | { kind: 'preset'; days: ActivityRange }
  | ({ kind: 'custom' } & CustomActivityRange)

type CalendarDay = {
  date: Date
  key: string
  count: number
  level: number
  outside: boolean
}

type CalendarMonth = {
  column: number
  key: string
  label: string
}

type WeeklyActivity = {
  activeDays: number
  count: number
  end: CalendarDay
  index: number
  key: string
  start: CalendarDay
}

type CumulativePoint = CalendarDay & {
  index: number
  total: number
  x: number
  y: number
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

function formatInspectDate(date: Date) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(date)
}

function formatMonth(date: Date) {
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric' }).format(date)
}

export function validateCustomActivityRange(
  range: CustomActivityRange,
  minimumDate: string,
  maximumDate: string,
) {
  const start = parseDateKey(range.startDate)
  const end = parseDateKey(range.endDate)
  if (!start || !end) return '请选择完整的开始和结束日期。'
  const minimum = parseDateKey(minimumDate)
  const maximum = parseDateKey(maximumDate)
  if (!minimum || !maximum || start < minimum || start > maximum || end < minimum || end > maximum) {
    return `可统计范围为 ${minimumDate} 至 ${maximumDate}。`
  }
  if (end < start) return '开始日期不能晚于结束日期。'
  return ''
}

/** A logarithmic scale keeps ordinary study days legible when one day is unusually busy. */
export function activityLevel(count: number, maximum: number) {
  if (count <= 0 || maximum <= 0) return 0
  return Math.min(4, Math.max(1, Math.ceil((Math.log1p(count) / Math.log1p(maximum)) * 4)))
}

export function summarizeActivity(activity: ReadonlyArray<{ count: number }>) {
  let activeDays = 0
  let longestStreak = 0
  let run = 0
  let practiceCount = 0

  for (const entry of activity) {
    const count = Math.max(0, Number.isFinite(entry.count) ? entry.count : 0)
    practiceCount += count
    if (count > 0) {
      activeDays += 1
      run += 1
      longestStreak = Math.max(longestStreak, run)
    } else {
      run = 0
    }
  }

  let currentStreak = 0
  let cursor = activity.length - 1
  // Match the server rule: an empty today does not erase a streak ending yesterday.
  if (activity[cursor]?.count === 0) cursor -= 1
  while (cursor >= 0 && activity[cursor]!.count > 0) {
    currentStreak += 1
    cursor -= 1
  }

  return { activeDays, currentStreak, longestStreak, practiceCount }
}

export function buildActivityCalendar(
  profile: Pick<AccountStudyProfile, 'activityWindow' | 'activity'>,
  range: ActivityCalendarRange = 90,
) {
  const windowStart = parseDateKey(profile.activityWindow.startDate)
  const windowEnd = parseDateKey(profile.activityWindow.endDate)
  if (!windowStart || !windowEnd || windowEnd < windowStart) return null

  const customStart = typeof range === 'number' ? null : parseDateKey(range.startDate)
  const customEnd = typeof range === 'number' ? null : parseDateKey(range.endDate)
  if (typeof range !== 'number' && (!customStart || !customEnd || customEnd < customStart)) return null
  const requestedEnd = customEnd ?? windowEnd
  const end = requestedEnd > windowEnd ? windowEnd : requestedEnd
  const requestedStart = typeof range === 'number' ? addDays(end, -(range - 1)) : customStart!
  const start = requestedStart < windowStart ? windowStart : requestedStart
  if (end < start) return null
  const startKey = dateKey(start)
  const endKey = dateKey(end)
  const counts = new Map<string, number>()

  for (const item of profile.activity) {
    const key = item.date.slice(0, 10)
    if (/^\d{4}-\d{2}-\d{2}$/.test(key) && key >= startKey && key <= endKey) {
      counts.set(key, (counts.get(key) ?? 0) + Math.max(0, item.count))
    }
  }

  const maximum = Math.max(0, ...counts.values())
  const firstMonday = mondayFor(start)
  const lastSunday = addDays(mondayFor(end), 6)
  const weekCount = Math.max(1, Math.ceil((daysBetween(firstMonday, lastSunday) + 1) / 7))
  const weeks: CalendarDay[][] = []
  const days: CalendarDay[] = []
  const dayByKey = new Map<string, CalendarDay>()

  for (let week = 0; week < weekCount; week += 1) {
    const weekStart = addDays(firstMonday, week * 7)
    weeks.push(Array.from({ length: 7 }, (_, weekday) => {
      const date = addDays(weekStart, weekday)
      const key = dateKey(date)
      const count = counts.get(key) ?? 0
      const calendarDay = {
        date,
        key,
        count,
        level: activityLevel(count, maximum),
        outside: date < start || date > end,
      }
      if (!calendarDay.outside) {
        days.push(calendarDay)
        dayByKey.set(key, calendarDay)
      }
      return calendarDay
    }))
  }

  const months: CalendarMonth[] = []
  let previousMonth = ''
  weeks.forEach((week, index) => {
    const firstVisibleDay = week.find((day) => !day.outside)
    if (!firstVisibleDay) return
    const monthKey = `${firstVisibleDay.date.getFullYear()}-${firstVisibleDay.date.getMonth()}`
    if (monthKey === previousMonth) return
    previousMonth = monthKey
    months.push({ column: index + 1, key: monthKey, label: formatMonth(firstVisibleDay.date) })
  })

  return { start, end, weeks, months, maximum, days, dayByKey }
}

export function buildWeeklyActivity(weeks: ReadonlyArray<ReadonlyArray<CalendarDay>>) {
  return weeks.flatMap((week, index): WeeklyActivity[] => {
    const visibleDays = week.filter((day) => !day.outside)
    const start = visibleDays[0]
    const end = visibleDays.at(-1)
    if (!start || !end) return []
    return [{
      activeDays: visibleDays.filter((day) => day.count > 0).length,
      count: visibleDays.reduce((total, day) => total + day.count, 0),
      end,
      index,
      key: `${start.key}:${end.key}`,
      start,
    }]
  })
}

export function buildCumulativeActivity(days: ReadonlyArray<CalendarDay>) {
  let total = 0
  const totals = days.map((day) => {
    total += day.count
    return total
  })
  const maximum = Math.max(1, totals.at(-1) ?? 0)
  return days.map((day, index): CumulativePoint => ({
    ...day,
    index,
    total: totals[index] ?? 0,
    x: days.length <= 1 ? 0 : (index / (days.length - 1)) * 100,
    y: 38 - ((totals[index] ?? 0) / maximum) * 32,
  }))
}

function formatWeekRange(start: Date, end: Date) {
  const formatter = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' })
  return `${formatter.format(start)} 至 ${formatter.format(end)}`
}

function formatAxisDate(date: Date) {
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' }).format(date)
}

export type AccountActivityHeatmapProps = {
  profile: Pick<AccountStudyProfile, 'activityWindow' | 'activity'> | null
  loading: boolean
  error: string
  onRetry: () => void
}

export function AccountActivityHeatmap({ profile, loading, error, onRetry }: AccountActivityHeatmapProps) {
  const [rangeSelection, setRangeSelection] = useState<ActivityRangeSelection>({ kind: 'preset', days: 90 })
  const [customRangeOpen, setCustomRangeOpen] = useState(false)
  const [customRangeDraft, setCustomRangeDraft] = useState<CustomActivityRange>({ startDate: '', endDate: '' })
  const [customRangeError, setCustomRangeError] = useState('')
  const [view, setView] = useState<ActivityView>('daily')
  const calendarRange = rangeSelection.kind === 'custom' ? rangeSelection : rangeSelection.days
  const calendar = useMemo(() => (profile ? buildActivityCalendar(profile, calendarRange) : null), [profile, calendarRange])
  const fallbackKey = calendar ? dateKey(calendar.end) : ''
  const [selectedKey, setSelectedKey] = useState(fallbackKey)
  const [previewKey, setPreviewKey] = useState('')
  const gridRef = useRef<HTMLDivElement>(null)
  const weeklyRef = useRef<HTMLDivElement>(null)
  const cumulativeRef = useRef<HTMLDivElement>(null)
  const customToggleRef = useRef<HTMLButtonElement>(null)
  const customStartRef = useRef<HTMLInputElement>(null)
  const activeKey = calendar?.dayByKey.has(selectedKey) ? selectedKey : fallbackKey
  const detailKey = calendar?.dayByKey.has(previewKey) ? previewKey : activeKey
  const detailDay = detailKey ? calendar?.dayByKey.get(detailKey) : undefined
  const summary = useMemo(() => summarizeActivity(calendar?.days ?? []), [calendar])
  const weeklyActivity = useMemo(() => buildWeeklyActivity(calendar?.weeks ?? []), [calendar])
  const cumulativeActivity = useMemo(() => buildCumulativeActivity(calendar?.days ?? []), [calendar])
  const maximumWeek = Math.max(0, ...weeklyActivity.map((week) => week.count))
  const activeWeek = weeklyActivity.find((week) => activeKey >= week.start.key && activeKey <= week.end.key)
  const detailWeek = weeklyActivity.find((week) => detailKey >= week.start.key && detailKey <= week.end.key) ?? activeWeek
  const detailCumulative = cumulativeActivity.find((point) => point.key === detailKey)
    ?? cumulativeActivity.find((point) => point.key === activeKey)
  const rangeLabel = rangeSelection.kind === 'custom'
    ? calendar
      ? `${formatDate(calendar.start)} 至 ${formatDate(calendar.end)} · ${calendar.days.length} 天`
      : '自定义时间范围'
    : `近 ${calendar?.days.length ?? rangeSelection.days} 天`
  const todayKey = dateKey(new Date())
  const cumulativeLine = cumulativeActivity.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
  const cumulativeArea = cumulativeActivity.length > 0
    ? `M ${cumulativeActivity[0]!.x} 38 ${cumulativeActivity.map((point) => `L ${point.x} ${point.y}`).join(' ')} L ${cumulativeActivity.at(-1)!.x} 38 Z`
    : ''

  const detail = view === 'weekly' && detailWeek
    ? {
        count: detailWeek.count,
        kicker: '所选周',
        label: formatWeekRange(detailWeek.start.date, detailWeek.end.date),
        unit: '词次',
      }
    : view === 'cumulative' && detailCumulative
      ? {
          count: detailCumulative.total,
          kicker: detailCumulative.key === todayKey ? '截至今天' : '累计至',
          label: formatInspectDate(detailCumulative.date),
          unit: '词次',
        }
      : {
          count: detailDay?.count ?? 0,
          kicker: detailDay?.key === todayKey ? '今天' : '所选日期',
          label: detailDay ? formatInspectDate(detailDay.date) : '日期未知',
          unit: '个词',
        }
  const detailDateTime = view === 'weekly'
    ? detailWeek?.start.key
    : view === 'cumulative'
      ? detailCumulative?.key
      : detailDay?.key

  useEffect(() => {
    if (!calendar || calendar.dayByKey.has(selectedKey)) return
    setSelectedKey(fallbackKey)
    setPreviewKey('')
  }, [calendar, fallbackKey, selectedKey])

  useEffect(() => {
    if (!customRangeOpen) return
    customStartRef.current?.focus()
  }, [customRangeOpen])

  useEffect(() => {
    if (!customRangeOpen) return
    function handleEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeCustomRange(true)
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [customRangeOpen])

  const minimumDate = profile?.activityWindow.startDate.slice(0, 10) ?? ''
  const maximumDate = profile?.activityWindow.endDate.slice(0, 10) ?? ''

  function closeCustomRange(restoreFocus = false) {
    setCustomRangeOpen(false)
    setCustomRangeError('')
    if (restoreFocus) {
      const focus = () => customToggleRef.current?.focus()
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(focus)
      else focus()
    }
  }

  function openCustomRange() {
    if (!profile) return
    const startDate = rangeSelection.kind === 'custom'
      ? rangeSelection.startDate
      : calendar
        ? dateKey(calendar.start)
        : minimumDate
    const endDate = rangeSelection.kind === 'custom'
      ? rangeSelection.endDate
      : calendar
        ? dateKey(calendar.end)
        : maximumDate
    setCustomRangeDraft({ startDate, endDate })
    setCustomRangeError('')
    setCustomRangeOpen(true)
  }

  function applyCustomRange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!profile) return
    const validation = validateCustomActivityRange(customRangeDraft, minimumDate, maximumDate)
    if (validation) {
      setCustomRangeError(validation)
      return
    }
    setRangeSelection({ kind: 'custom', ...customRangeDraft })
    closeCustomRange(true)
  }

  function selectAndFocus(key: string) {
    setSelectedKey(key)
    setPreviewKey(key)
    const focus = () => gridRef.current?.querySelector<HTMLButtonElement>(`button[data-date='${key}']`)?.focus()
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(focus)
    else focus()
  }

  function chooseView(nextView: ActivityView) {
    setView(nextView)
    setPreviewKey('')
  }

  function moveSelection(event: KeyboardEvent<HTMLButtonElement>, day: CalendarDay) {
    if (!calendar) return
    let nextKey = ''
    if (event.key === 'Home') nextKey = dateKey(calendar.start)
    else if (event.key === 'End') nextKey = dateKey(calendar.end)
    else {
      const offset = event.key === 'ArrowLeft'
        ? -7
        : event.key === 'ArrowRight'
          ? 7
          : event.key === 'ArrowUp'
            ? -1
            : event.key === 'ArrowDown'
              ? 1
              : 0
      if (!offset) return
      nextKey = dateKey(addDays(day.date, offset))
    }
    if (!calendar.dayByKey.has(nextKey)) return
    event.preventDefault()
    selectAndFocus(nextKey)
  }

  function moveWeekSelection(event: KeyboardEvent<HTMLButtonElement>, week: WeeklyActivity) {
    const offset = event.key === 'ArrowLeft' || event.key === 'ArrowUp'
      ? -1
      : event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : 0
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? weeklyActivity.length - 1
        : week.index + offset
    if ((!offset && event.key !== 'Home' && event.key !== 'End') || nextIndex < 0 || nextIndex >= weeklyActivity.length) return
    const nextWeek = weeklyActivity[nextIndex]
    if (!nextWeek) return
    event.preventDefault()
    setSelectedKey(nextWeek.end.key)
    setPreviewKey(nextWeek.end.key)
    const focus = () => weeklyRef.current?.querySelector<HTMLButtonElement>(`button[data-week='${nextWeek.index}']`)?.focus()
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(focus)
    else focus()
  }

  function moveCumulativeSelection(event: KeyboardEvent<HTMLButtonElement>, point: CumulativePoint) {
    const offset = event.key === 'ArrowLeft' || event.key === 'ArrowUp'
      ? -1
      : event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : 0
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? cumulativeActivity.length - 1
        : point.index + offset
    if ((!offset && event.key !== 'Home' && event.key !== 'End') || nextIndex < 0 || nextIndex >= cumulativeActivity.length) return
    const nextPoint = cumulativeActivity[nextIndex]
    if (!nextPoint) return
    event.preventDefault()
    setSelectedKey(nextPoint.key)
    setPreviewKey(nextPoint.key)
    const focus = () => cumulativeRef.current?.querySelector<HTMLButtonElement>(`button[data-point='${nextPoint.index}']`)?.focus()
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(focus)
    else focus()
  }

  return (
    <section className="account-activity" aria-labelledby="account-activity-title">
      <header className="account-activity-heading">
        <div className="account-activity-heading-copy">
          <h2 id="account-activity-title">学习活跃度</h2>
          <p>新词、复习和听写按当天练习过的去重词数统计。</p>
        </div>
        <div className="account-activity-view-switch" role="group" aria-label="活跃度视图">
          {ACTIVITY_VIEWS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-label={`${option.accessibleLabel}视图`}
              aria-pressed={view === option.id}
              aria-controls="account-activity-visual"
              disabled={loading}
              onClick={() => chooseView(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="account-activity-range-switch" role="group" aria-label="活跃度时间范围">
          {ACTIVITY_RANGES.map((range) => (
            <button
              key={range}
              type="button"
              aria-pressed={rangeSelection.kind === 'preset' && rangeSelection.days === range}
              disabled={loading || !profile}
              onClick={() => {
                setRangeSelection({ kind: 'preset', days: range })
                closeCustomRange()
              }}
            >
              {range} 天
            </button>
          ))}
          <button
            ref={customToggleRef}
            type="button"
            aria-label="自定义时间范围"
            aria-pressed={rangeSelection.kind === 'custom'}
            aria-expanded={customRangeOpen}
            aria-controls="account-activity-custom-range"
            disabled={loading || !profile}
            onClick={() => {
              if (customRangeOpen) closeCustomRange()
              else openCustomRange()
            }}
          >
            自定义
          </button>
        </div>
        {customRangeOpen && (
          <form
            id="account-activity-custom-range"
            className="account-activity-custom-range"
            aria-label="自定义统计时间段"
            onSubmit={applyCustomRange}
          >
            <div className="account-activity-custom-range-fields">
              <div className="account-activity-custom-field">
                <label htmlFor="account-activity-custom-start">开始日期</label>
                <input
                  ref={customStartRef}
                  id="account-activity-custom-start"
                  type="date"
                  value={customRangeDraft.startDate}
                  min={minimumDate}
                  max={customRangeDraft.endDate || maximumDate}
                  aria-invalid={Boolean(customRangeError)}
                  aria-describedby={customRangeError ? 'account-activity-custom-range-error' : undefined}
                  onChange={(event) => {
                    setCustomRangeDraft((draft) => ({ ...draft, startDate: event.target.value }))
                    setCustomRangeError('')
                  }}
                />
              </div>
              <div className="account-activity-custom-field">
                <label htmlFor="account-activity-custom-end">结束日期</label>
                <input
                  id="account-activity-custom-end"
                  type="date"
                  value={customRangeDraft.endDate}
                  min={customRangeDraft.startDate || minimumDate}
                  max={maximumDate}
                  aria-invalid={Boolean(customRangeError)}
                  aria-describedby={customRangeError ? 'account-activity-custom-range-error' : undefined}
                  onChange={(event) => {
                    setCustomRangeDraft((draft) => ({ ...draft, endDate: event.target.value }))
                    setCustomRangeError('')
                  }}
                />
              </div>
            </div>
            <div className="account-activity-custom-range-actions">
              <div>
                <p className="account-activity-custom-range-hint">可选范围：{minimumDate} 至 {maximumDate}</p>
                {customRangeError && (
                  <p id="account-activity-custom-range-error" className="account-activity-custom-range-error" role="alert">
                    {customRangeError}
                  </p>
                )}
              </div>
              <div className="account-activity-custom-range-buttons">
                <button type="button" className="account-activity-custom-range-cancel" onClick={() => closeCustomRange(true)}>取消</button>
                <button type="submit" className="account-activity-custom-range-apply">应用</button>
              </div>
            </div>
          </form>
        )}
      </header>

      {loading ? (
        <div className="account-activity-panel account-activity-panel-loading" role="status" aria-label="正在加载学习活跃度">
          <div className="account-activity-summary-loading"><span /><span /><span /></div>
          <div className="account-heatmap-loading">
            {Array.from({ length: 7 * 14 }, (_, index) => <span key={index} />)}
          </div>
        </div>
      ) : error || !calendar ? (
        <div className="account-profile-error account-activity-error">
          <p role="alert">{error || '学习活跃度暂时无法加载。'}</p>
          <button type="button" onClick={onRetry}>重试</button>
        </div>
      ) : (
        <div className="account-activity-panel">
          <dl className="account-activity-summary" aria-label={`${rangeLabel}学习摘要`}>
            <div>
              <dt>当前连续</dt>
              <dd>{summary.currentStreak}<span>天</span></dd>
            </div>
            <div>
              <dt>最长连续</dt>
              <dd>{summary.longestStreak}<span>天</span></dd>
            </div>
            <div>
              <dt>学习词次</dt>
              <dd>{summary.practiceCount}<span>次</span></dd>
            </div>
          </dl>

          <div className="account-activity-chart" id="account-activity-visual">
            <div className="account-heatmap-meta">
              <p title={`${formatDate(calendar.start)} 至 ${formatDate(calendar.end)}`}>
                {rangeLabel} · {summary.activeDays} 个活跃日
              </p>
              {view === 'daily' ? (
                <div className="account-heatmap-legend" aria-label="活跃度图例">
                  <span>少</span>
                  {[0, 1, 2, 3, 4].map((level) => <i key={level} data-level={level} aria-hidden="true" />)}
                  <span>多</span>
                </div>
              ) : (
                <span className="account-activity-view-caption">{view === 'weekly' ? '按周合计' : '逐日累计'}</span>
              )}
            </div>

            {view === 'daily' ? (
              <div className="account-heatmap-scroll">
                <div
                  className="account-heatmap-canvas"
                  style={{
                    '--heatmap-columns': calendar.weeks.length,
                    '--heatmap-canvas-width': `${1.83 + calendar.weeks.length * 3.25}rem`,
                  } as CSSProperties}
                >
                  <div
                    className="account-heatmap-months"
                    aria-hidden="true"
                  >
                    {calendar.months.map((month) => (
                      <span key={month.key} style={{ gridColumn: month.column }}>{month.label}</span>
                    ))}
                  </div>
                  <div className="account-heatmap-body">
                    <div className="account-weekday-labels" aria-hidden="true">
                      {WEEKDAY_LABELS.map((label) => <span key={label}>{label}</span>)}
                    </div>
                    <div
                      ref={gridRef}
                      className="account-heatmap-grid"
                      aria-label={`${rangeLabel}每日学习词数。使用方向键浏览日期，Home 和 End 跳到范围首尾。`}
                      onPointerLeave={() => setPreviewKey('')}
                    >
                      {calendar.weeks.flatMap((week, weekIndex) => week.map((day, weekday) => {
                        const position = { gridColumn: weekIndex + 1, gridRow: weekday + 1 }
                        if (day.outside) {
                          return <span key={`${day.key}-outside`} className="account-heatmap-cell is-outside" style={position} aria-hidden="true" />
                        }
                        const label = `${formatDate(day.date)}，学习 ${day.count} 个词${day.key === todayKey ? '，今天' : ''}`
                        return (
                          <button
                            key={day.key}
                            type="button"
                            className="account-heatmap-cell"
                            style={position}
                            data-date={day.key}
                            data-level={day.level}
                            data-today={day.key === todayKey ? 'true' : undefined}
                            aria-label={label}
                            aria-pressed={day.key === activeKey}
                            aria-describedby="account-activity-day-detail"
                            tabIndex={day.key === activeKey ? 0 : -1}
                            title={label}
                            onClick={() => setSelectedKey(day.key)}
                            onFocus={() => setPreviewKey(day.key)}
                            onBlur={() => setPreviewKey('')}
                            onPointerEnter={() => setPreviewKey(day.key)}
                            onKeyDown={(event) => moveSelection(event, day)}
                          />
                        )
                      }))}
                    </div>
                  </div>
                </div>
              </div>
            ) : view === 'weekly' ? (
              <div
                ref={weeklyRef}
                className="account-weekly-chart"
                aria-label={`${rangeLabel}每周学习词次。使用方向键浏览各周。`}
                onPointerLeave={() => setPreviewKey('')}
              >
                <div className="account-chart-scale" aria-hidden="true">
                  <span>{maximumWeek}</span>
                  <span>0</span>
                </div>
                <div
                  className="account-weekly-bars"
                  style={{ '--weekly-columns': weeklyActivity.length } as CSSProperties}
                >
                  {weeklyActivity.map((week, index) => {
                    const selected = activeWeek?.key === week.key
                    const showLabel = weeklyActivity.length <= 7 || index % 2 === 0 || index === weeklyActivity.length - 1
                    const label = `${formatWeekRange(week.start.date, week.end.date)}，学习 ${week.count} 词次，${week.activeDays} 个活跃日`
                    const barHeight = maximumWeek > 0 ? Math.max(week.count > 0 ? 8 : 0, (week.count / maximumWeek) * 100) : 0
                    return (
                      <button
                        key={week.key}
                        type="button"
                        className="account-weekly-bar"
                        style={{ '--bar-height': `${barHeight}%` } as CSSProperties}
                        data-level={activityLevel(week.count, maximumWeek)}
                        data-week={week.index}
                        aria-label={label}
                        aria-pressed={selected}
                        aria-describedby="account-activity-day-detail"
                        tabIndex={selected ? 0 : -1}
                        title={label}
                        onClick={() => setSelectedKey(week.end.key)}
                        onFocus={() => setPreviewKey(week.end.key)}
                        onBlur={() => setPreviewKey('')}
                        onPointerEnter={() => setPreviewKey(week.end.key)}
                        onKeyDown={(event) => moveWeekSelection(event, week)}
                      >
                        <i aria-hidden="true" />
                        <span aria-hidden="true">{showLabel ? formatAxisDate(week.start.date) : ''}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : (
              <div
                ref={cumulativeRef}
                className="account-cumulative-chart"
                aria-label={`${rangeLabel}累计学习词次。使用方向键逐日浏览。`}
                onPointerLeave={() => setPreviewKey('')}
              >
                <div className="account-chart-scale" aria-hidden="true">
                  <span>{summary.practiceCount}</span>
                  <span>0</span>
                </div>
                <div className="account-cumulative-plot">
                  <svg viewBox="0 0 100 42" preserveAspectRatio="none" aria-hidden="true" focusable="false">
                    {[6, 14, 22, 30, 38].map((line) => (
                      <line key={line} className="account-cumulative-grid-line" x1="0" x2="100" y1={line} y2={line} />
                    ))}
                    <path className="account-cumulative-area" d={cumulativeArea} />
                    <path className="account-cumulative-line" d={cumulativeLine} />
                  </svg>
                  {detailCumulative && (
                    <div
                      className="account-cumulative-marker"
                      style={{
                        '--point-x': `${detailCumulative.x}%`,
                        '--point-y': `${(detailCumulative.y / 42) * 100}%`,
                      } as CSSProperties}
                      aria-hidden="true"
                    ><i /></div>
                  )}
                  <div
                    className="account-cumulative-hits"
                    style={{ '--point-columns': cumulativeActivity.length } as CSSProperties}
                  >
                    {cumulativeActivity.map((point) => {
                      const selected = point.key === activeKey
                      const label = `${formatDate(point.date)}，累计学习 ${point.total} 词次`
                      return (
                        <button
                          key={point.key}
                          type="button"
                          data-point={point.index}
                          aria-label={label}
                          aria-pressed={selected}
                          aria-describedby="account-activity-day-detail"
                          tabIndex={selected ? 0 : -1}
                          title={label}
                          onClick={() => setSelectedKey(point.key)}
                          onFocus={() => setPreviewKey(point.key)}
                          onBlur={() => setPreviewKey('')}
                          onPointerEnter={() => setPreviewKey(point.key)}
                          onKeyDown={(event) => moveCumulativeSelection(event, point)}
                        />
                      )
                    })}
                  </div>
                </div>
                <div className="account-cumulative-axis" aria-hidden="true">
                  <span>{formatAxisDate(calendar.start)}</span>
                  <span>{formatAxisDate(calendar.end)}</span>
                </div>
              </div>
            )}

            <div className="account-activity-day-detail" id="account-activity-day-detail">
              <div>
                <span>{detail.kicker}</span>
                <time dateTime={detailDateTime}>{detail.label}</time>
              </div>
              <p>
                <strong>{detail.count}</strong>
                <span>{detail.unit}</span>
              </p>
            </div>
            {summary.practiceCount === 0 && (
              <p className="account-activity-empty-note">完成一次新词、复习或听写后，这里会出现第一条记录。</p>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
