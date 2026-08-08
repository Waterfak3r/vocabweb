import { describe, expect, it } from 'vitest'
import { WorkspaceApiError } from '../data/workspaceApi'
import { conflictEntrySummary, conflictReasonLabel, parseContributionConflicts } from './ContributionDetailPage'

const entry = (word: string, definition: string) => ({
  word,
  phonetic: `/${word}/`,
  meanings: [{ pos: 'noun', definition }],
  source: 'user',
})

describe('ContributionDetailPage conflict details', () => {
  it('safely parses backend conflict details and keeps current/proposed entries', () => {
    const error = new WorkspaceApiError(409, 'CONTRIBUTION_CONFLICT', 'conflict', {
      conflicts: [{
        key: 'alpha',
        reason: 'overlapping-change',
        current: entry('alpha', 'current meaning'),
        proposed: entry('alpha', 'proposed meaning'),
      }],
    })

    expect(parseContributionConflicts(error)).toEqual([{
      key: 'alpha',
      reason: 'overlapping-change',
      current: entry('alpha', 'current meaning'),
      proposed: entry('alpha', 'proposed meaning'),
    }])
    expect(conflictEntrySummary(parseContributionConflicts(error)[0].current)).toContain('current meaning')
    expect(conflictReasonLabel('overlapping-change')).toBe('公开版本与建议修改重叠')
  })

  it('drops malformed conflict records while retaining ordinary error behavior', () => {
    const error = { details: { conflicts: [{ key: 'bad', reason: 'unknown' }, { key: 'ok', reason: 'source-diverged' }] } }
    expect(parseContributionConflicts(error)).toEqual([{
      key: 'ok',
      reason: 'source-diverged',
      current: undefined,
      proposed: undefined,
      base: undefined,
    }])
    expect(parseContributionConflicts(new Error('no details'))).toEqual([])
  })
})
