import { describe, expect, it } from 'vitest'
import { draftMatchProgress, importDraftGroup, importProblemEntries } from './ImportWordbookDialog'

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

  it('waits for duplicate and wordbook-conflict entries to receive resolved data', () => {
    expect(draftMatchProgress([
      { status: 'duplicate' },
      { status: 'conflict', entry: { word: 'alpha', phonetic: '', meanings: [], source: 'user' } },
    ])).toEqual({ total: 2, completed: 1, percent: 50 })
  })
})

describe('import draft group summary', () => {
  it('loads the entire group in batch order, including already committed legacy batches', () => {
    const base = { title: 'Large', description: '', totalBatches: 3, entries: [] }
    const drafts = [
      { ...base, id: 'third', groupId: 'group-a', batchIndex: 3, status: 'pending' as const },
      { ...base, id: 'other', groupId: 'group-b', batchIndex: 1, status: 'pending' as const },
      { ...base, id: 'first', groupId: 'group-a', batchIndex: 1, status: 'committed' as const },
      { ...base, id: 'second', groupId: 'group-a', batchIndex: 2, status: 'pending' as const },
    ]
    expect(importDraftGroup(drafts, { id: 'first', groupId: 'group-a' }).map((draft) => draft.id)).toEqual(['first', 'second', 'third'])
  })

  it('shows only entries that need a final decision', () => {
    expect(importProblemEntries([
      { line: 1, word: 'ready', status: 'ready' },
      { line: 2, word: 'working', status: 'processing' },
      { line: 3, word: 'duplicate', status: 'duplicate' },
      { line: 4, status: 'invalid' },
      { line: 5, word: 'unknown', status: 'unmatched' },
      { line: 6, word: 'existing', status: 'conflict' },
    ]).map((entry) => entry.status)).toEqual(['duplicate', 'invalid', 'unmatched', 'conflict'])
  })
})
