import { describe, expect, it } from 'vitest'
import { draftMatchProgress } from './ImportWordbookDialog'

describe('draftMatchProgress', () => {
  it('counts unresolved entries while a background dictionary job is running', () => {
    expect(draftMatchProgress([
      { status: 'processing' },
      { status: 'ready' },
      { status: 'unmatched' },
    ])).toEqual({ total: 3, completed: 2, percent: 67 })
  })

  it('treats an empty batch as complete without dividing by zero', () => {
    expect(draftMatchProgress([])).toEqual({ total: 0, completed: 0, percent: 0 })
  })
})
