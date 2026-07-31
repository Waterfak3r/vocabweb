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

export function isDailyPlanComplete(target: number, completed: number): boolean {
  return Math.floor(target) > 0 && remainingPlanWords(target, completed) === 0
}

export function studyPlanActionLabel({
  target,
  completed,
  available,
  loading,
  resume,
  startLabel,
  completedActionLabel,
}: {
  target: number
  completed: number
  available: number
  loading: boolean
  resume: boolean
  startLabel: string
  completedActionLabel?: string
}): string {
  if (loading) return '加载中…'
  if (resume) return `继续上次进度（${available}）`
  if (isDailyPlanComplete(target, completed) && completedActionLabel) return completedActionLabel
  if (target > 0 && remainingPlanWords(target, completed) === 0 && available > 0) return '继续加练'
  if (available > 0) return startLabel
  if (target > 0 && remainingPlanWords(target, completed) === 0) return '今日计划已完成'
  return '暂无可学单词'
}
