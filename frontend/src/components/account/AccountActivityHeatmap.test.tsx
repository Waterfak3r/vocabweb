import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AccountStudyProfile } from '../../data/workspaceApi'
import {
  AccountActivityHeatmap,
  activityLevel,
  buildActivityCalendar,
  buildCumulativeActivity,
  buildWeeklyActivity,
  summarizeActivity,
  validateCustomActivityRange,
} from './AccountActivityHeatmap'

function dateKey(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function profile(): Pick<AccountStudyProfile, 'activityWindow' | 'activity'> {
  const start = new Date(2026, 4, 12)
  const activity = Array.from({ length: 90 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    return { date: dateKey(date), count: index % 9 === 0 ? 12 : index % 3 === 0 ? 3 : 0 }
  })
  return {
    activityWindow: {
      startDate: activity[0]!.date,
      endDate: activity.at(-1)!.date,
      days: 90,
    },
    activity,
  }
}

describe('AccountActivityHeatmap data views', () => {
  it('uses a logarithmic intensity scale so a busy outlier does not flatten ordinary days', () => {
    expect(activityLevel(0, 100)).toBe(0)
    expect(activityLevel(1, 100)).toBe(1)
    expect(activityLevel(10, 100)).toBe(3)
    expect(activityLevel(100, 100)).toBe(4)
  })

  it('summarizes active days and keeps a streak that ended yesterday', () => {
    expect(summarizeActivity([
      { count: 1 },
      { count: 1 },
      { count: 0 },
      { count: 2 },
      { count: 3 },
      { count: 0 },
    ])).toEqual({
      activeDays: 4,
      currentStreak: 2,
      longestStreak: 2,
      practiceCount: 7,
    })
  })

  it('builds matching daily, weekly, and cumulative totals for the selected range', () => {
    const calendar = buildActivityCalendar(profile(), 30)
    expect(calendar).not.toBeNull()
    expect(calendar!.days).toHaveLength(30)

    const total = calendar!.days.reduce((sum, day) => sum + day.count, 0)
    const weeks = buildWeeklyActivity(calendar!.weeks)
    const cumulative = buildCumulativeActivity(calendar!.days)

    expect(weeks.reduce((sum, week) => sum + week.count, 0)).toBe(total)
    expect(cumulative.at(-1)?.total).toBe(total)
    expect(cumulative[0]?.x).toBe(0)
    expect(cumulative.at(-1)?.x).toBe(100)
  })

  it('validates custom ranges against the available activity window', () => {
    const minimumDate = profile().activityWindow.startDate
    const maximumDate = profile().activityWindow.endDate

    expect(validateCustomActivityRange({ startDate: '', endDate: '' }, minimumDate, maximumDate)).toBe('请选择完整的开始和结束日期。')
    expect(validateCustomActivityRange({ startDate: '2026-06-15', endDate: '2026-06-14' }, minimumDate, maximumDate)).toBe('开始日期不能晚于结束日期。')
    expect(validateCustomActivityRange({ startDate: '2026-05-01', endDate: '2026-05-14' }, minimumDate, maximumDate)).toContain('可统计范围为')
    expect(validateCustomActivityRange({ startDate: '2026-06-01', endDate: '2026-06-10' }, minimumDate, maximumDate)).toBe('')
  })

  it('builds a custom calendar with only the requested days and totals', () => {
    const range = { startDate: '2026-06-01', endDate: '2026-06-10' }
    const calendar = buildActivityCalendar(profile(), range)
    expect(calendar).not.toBeNull()
    expect(calendar!.days).toHaveLength(10)
    expect(dateKey(calendar!.start)).toBe(range.startDate)
    expect(dateKey(calendar!.end)).toBe(range.endDate)

    const sourceTotal = profile().activity
      .filter((entry) => entry.date >= range.startDate && entry.date <= range.endDate)
      .reduce((sum, entry) => sum + entry.count, 0)
    expect(calendar!.days.reduce((sum, day) => sum + day.count, 0)).toBe(sourceTotal)
    expect(buildCumulativeActivity(calendar!.days).at(-1)?.total).toBe(sourceTotal)
  })

  it('renders the centered three-view switch and range controls', () => {
    const html = renderToStaticMarkup(createElement(AccountActivityHeatmap, {
      profile: profile(),
      loading: false,
      error: '',
      onRetry: () => undefined,
    }))

    expect(html).toContain('aria-label="活跃度视图"')
    expect(html).toContain('>Daily</button>')
    expect(html).toContain('>Weekly</button>')
    expect(html).toContain('>Cumulative</button>')
    expect(html).toContain('aria-label="活跃度时间范围"')
    expect(html).toContain('aria-label="自定义时间范围"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('aria-controls="account-activity-custom-range"')
    expect(html).toContain('account-activity-panel')
    expect(html).toContain('使用方向键浏览日期')
  })
})
