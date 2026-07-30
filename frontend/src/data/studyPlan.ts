export type DailyPlan = {
  target: number
  remaining: number
}

/**
 * Keep the day's target stable while learned words leave the unstudied pool, but only deal the
 * unfinished part of that target when a learner opens the session again.
 */
export function dailyNewPlan(configured: number, completed: number, unstudied: number): DailyPlan {
  const safeConfigured = Math.max(0, Math.floor(configured))
  const safeCompleted = Math.max(0, Math.floor(completed))
  const safeUnstudied = Math.max(0, Math.floor(unstudied))
  const target = Math.min(safeConfigured, safeCompleted + safeUnstudied)
  return {
    target,
    remaining: Math.max(0, target - safeCompleted),
  }
}

export function remainingPlanWords(target: number, completed: number): number {
  return Math.max(0, Math.floor(target) - Math.max(0, Math.floor(completed)))
}
