import { describe, expect, it } from 'vitest'
import {
  DEFAULT_REVIEW_SCHEDULE,
  isDefaultReviewSchedule,
  isReviewDue,
  levelOf,
  parseReviewSchedule,
  reviewPriority,
  sameReviewSchedule,
} from './reviewSchedule'

describe('adaptive review schedule', () => {
  it('keeps mastered words in long-term review and honors the exact due instant', () => {
    const word = { level: 4 as const, nextReviewAt: '2026-02-03T09:00:00.000Z' }
    expect(isReviewDue(word, new Date('2026-02-03T08:59:59.999Z'))).toBe(false)
    expect(isReviewDue(word, new Date('2026-02-03T09:00:00.000Z'))).toBe(true)
  })

  it('uses the 1/3/7/21-day fallback for rolling deployments with an older server', () => {
    const now = new Date('2026-01-04T09:00:00.000Z')
    expect(isReviewDue({ level: 2, lastStudiedAt: '2026-01-01T09:00:00.000Z' }, now)).toBe(true)
    expect(isReviewDue({ level: 3, lastStudiedAt: '2026-01-01T09:00:00.000Z' }, now)).toBe(false)
  })

  it('falls back from legacy statuses and orders the earliest checkpoint first', () => {
    expect(levelOf({ status: 'mastered' })).toBe(3)
    expect(reviewPriority({ level: 2, nextReviewAt: '2026-01-05T09:00:00.000Z' }))
      .toBeLessThan(reviewPriority({ level: 2, nextReviewAt: '2026-01-12T09:00:00.000Z' }))
  })

  it('validates monotonic custom plans and uses them for legacy due-date fallback', () => {
    const custom = {
      learningDays: 2,
      familiarDays: 5,
      masteredDays: 10,
      expertDays: 30,
      lapseDays: 2,
      maxDays: 45,
    }
    expect(parseReviewSchedule(custom)).toEqual(custom)
    expect(parseReviewSchedule({ ...custom, familiarDays: 1 })).toBeNull()
    expect(parseReviewSchedule({ ...custom, maxDays: 0 })).toBeNull()
    expect(isReviewDue(
      { level: 2, lastStudiedAt: '2026-01-01T09:00:00.000Z' },
      new Date('2026-01-05T09:00:00.000Z'),
      custom,
    )).toBe(false)
    expect(isReviewDue(
      { level: 2, lastStudiedAt: '2026-01-01T09:00:00.000Z' },
      new Date('2026-01-06T09:00:00.000Z'),
      custom,
    )).toBe(true)
    expect(isDefaultReviewSchedule(custom)).toBe(false)
    expect(isDefaultReviewSchedule(DEFAULT_REVIEW_SCHEDULE)).toBe(true)
    expect(sameReviewSchedule(custom, { ...custom })).toBe(true)
  })
})
