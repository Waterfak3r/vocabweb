import { describe, expect, it } from 'vitest'
import { dailyNewPlan, remainingPlanWords } from './studyPlan'

describe('daily study plan', () => {
  it('keeps the target stable but reduces the next new-word deck after each completion', () => {
    expect(dailyNewPlan(20, 0, 100)).toEqual({ target: 20, remaining: 20 })
    expect(dailyNewPlan(20, 1, 99)).toEqual({ target: 20, remaining: 19 })
    expect(dailyNewPlan(20, 20, 80)).toEqual({ target: 20, remaining: 0 })
  })

  it('never displays a negative remaining count', () => {
    expect(remainingPlanWords(10, 12)).toBe(0)
  })
})
