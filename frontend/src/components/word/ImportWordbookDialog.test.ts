import { describe, expect, it } from 'vitest'
import { draftMatchProgress, nextImportDraft } from './ImportWordbookDialog'

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

describe('nextImportDraft', () => {
  it('continues the same import group in batch order and skips committed batches', () => {
    const base = { title: 'Large', description: '', totalBatches: 3, entries: [] }
    const drafts = [
      { ...base, id: 'third', groupId: 'group-a', batchIndex: 3, status: 'pending' as const },
      { ...base, id: 'other', groupId: 'group-b', batchIndex: 1, status: 'pending' as const },
      { ...base, id: 'first', groupId: 'group-a', batchIndex: 1, status: 'committed' as const },
      { ...base, id: 'second', groupId: 'group-a', batchIndex: 2, status: 'pending' as const },
    ]
    expect(nextImportDraft(drafts, { id: 'first', groupId: 'group-a' })?.id).toBe('second')
  })
})
