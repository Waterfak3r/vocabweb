export type WordStatus = 'new' | 'learning' | 'review' | 'mastered'
export type WordLevel = 0 | 1 | 2 | 3 | 4

export type ReviewSchedule = {
  learningDays: number
  familiarDays: number
  masteredDays: number
  expertDays: number
  lapseDays: number
  maxDays: number
}

export const DEFAULT_REVIEW_SCHEDULE: ReviewSchedule = {
  learningDays: 1,
  familiarDays: 3,
  masteredDays: 7,
  expertDays: 21,
  lapseDays: 1,
  maxDays: 60,
}

export type ReviewScheduleEntry = {
  status?: WordStatus
  level?: WordLevel
  lastStudiedAt?: string
  reviewIntervalDays?: number
  nextReviewAt?: string
}

const DAY_MS = 86_400_000

function intervalForLevel(schedule: ReviewSchedule, level: WordLevel): number {
  return level === 0 ? 0
    : level === 1 ? schedule.learningDays
      : level === 2 ? schedule.familiarDays
        : level === 3 ? schedule.masteredDays
          : schedule.expertDays
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Strict parser shared by API decoding and local UI validation. */
export function parseReviewSchedule(value: unknown): ReviewSchedule | null {
  if (!isRecord(value)) return null
  const day = (item: unknown) => typeof item === 'number' && Number.isInteger(item) && item >= 1 && item <= 3650 ? item : null
  const learningDays = day(value.learningDays)
  const familiarDays = day(value.familiarDays)
  const masteredDays = day(value.masteredDays)
  const expertDays = day(value.expertDays)
  const lapseDays = day(value.lapseDays)
  const maxDays = day(value.maxDays)
  if (learningDays === null || familiarDays === null || masteredDays === null || expertDays === null || lapseDays === null || maxDays === null) return null
  if (learningDays > familiarDays || familiarDays > masteredDays || masteredDays > expertDays || expertDays > maxDays || lapseDays > maxDays) return null
  return { learningDays, familiarDays, masteredDays, expertDays, lapseDays, maxDays }
}

export function sameReviewSchedule(left: ReviewSchedule, right: ReviewSchedule): boolean {
  return Object.keys(DEFAULT_REVIEW_SCHEDULE)
    .every((key) => left[key as keyof ReviewSchedule] === right[key as keyof ReviewSchedule])
}

export function isDefaultReviewSchedule(schedule: ReviewSchedule): boolean {
  return sameReviewSchedule(schedule, DEFAULT_REVIEW_SCHEDULE)
}

/** Prefer the explicit ladder level and fall back to legacy status-only API payloads. */
export function levelOf(entry: ReviewScheduleEntry): WordLevel {
  return entry.level ?? (entry.status === 'learning' ? 1 : entry.status === 'review' ? 2 : entry.status === 'mastered' ? 3 : 0)
}

// Whole calendar days between two instants in the client's timezone. Modern servers send an exact
// nextReviewAt; this fallback only keeps older payloads usable during a rolling deployment.
function calendarDayDiff(from: Date, to: Date): number {
  const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  return Math.round((startOfDay(to) - startOfDay(from)) / DAY_MS)
}

/** Every learned level remains reviewable, including 掌握/精通. */
export function isReviewDue(
  entry: ReviewScheduleEntry,
  now: Date = new Date(),
  schedule: ReviewSchedule = DEFAULT_REVIEW_SCHEDULE,
): boolean {
  const level = levelOf(entry)
  if (level === 0) return false
  if (entry.nextReviewAt) {
    const due = Date.parse(entry.nextReviewAt)
    return !Number.isFinite(due) || now.getTime() >= due
  }
  if (!entry.lastStudiedAt) return true
  const last = new Date(entry.lastStudiedAt)
  if (Number.isNaN(last.getTime())) return true
  return calendarDayDiff(last, now) >= (entry.reviewIntervalDays || intervalForLevel(schedule, level))
}

/** Earlier timestamps sort first, making the most overdue item lead each study deck. */
export function reviewPriority(entry: ReviewScheduleEntry, schedule: ReviewSchedule = DEFAULT_REVIEW_SCHEDULE): number {
  if (entry.nextReviewAt) {
    const due = Date.parse(entry.nextReviewAt)
    if (Number.isFinite(due)) return due
  }
  if (entry.lastStudiedAt) {
    const last = Date.parse(entry.lastStudiedAt)
    if (Number.isFinite(last)) return last + (entry.reviewIntervalDays || intervalForLevel(schedule, levelOf(entry))) * DAY_MS
  }
  return Number.MIN_SAFE_INTEGER
}
