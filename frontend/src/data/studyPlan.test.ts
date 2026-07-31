import { describe, expect, it } from 'vitest'
import { dailyNewPlan, isDailyPlanComplete, remainingPlanWords, studyPlanActionLabel } from './studyPlan'

describe('daily study plan', () => {
  it('keeps the target stable but reduces the next new-word deck after each completion', () => {
    expect(dailyNewPlan(20, 0, 100)).toEqual({ target: 20, remaining: 20 })
    expect(dailyNewPlan(20, 1, 99)).toEqual({ target: 20, remaining: 19 })
    expect(dailyNewPlan(20, 20, 80)).toEqual({ target: 20, remaining: 0 })
  })

  it('never displays a negative remaining count', () => {
    expect(remainingPlanWords(10, 12)).toBe(0)
  })

  it('only switches to voluntary practice after a non-empty plan is complete', () => {
    expect(isDailyPlanComplete(30, 30)).toBe(true)
    expect(isDailyPlanComplete(30, 29)).toBe(false)
    expect(isDailyPlanComplete(0, 0)).toBe(false)
  })

  it('replaces a completed plan button with its ahead-learning action', () => {
    expect(studyPlanActionLabel({
      target: 30,
      completed: 30,
      available: 25,
      loading: false,
      resume: false,
      startLabel: '开始学习',
      completedActionLabel: '提前学习',
    })).toBe('提前学习')
    expect(studyPlanActionLabel({
      target: 5,
      completed: 5,
      available: 0,
      loading: false,
      resume: false,
      startLabel: '开始复习',
      completedActionLabel: '提前复习',
    })).toBe('提前复习')
  })
})
