import { describe, expect, it, vi } from 'vitest'
import type { MyWordbook } from '../../data/workspaceApi'
import { commitImportedDraft, draftMatchProgress, groupProcessingState, importDraftGroup, importProblemEntries } from './ImportWordbookDialog'

const wordbook = (overrides: Partial<MyWordbook> = {}): MyWordbook => ({
  id: 'wordbook-1',
  title: 'Imported',
  description: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  wordCount: 1,
  progress: { mastered: 0, learning: 0, review: 0, unstudied: 1, percent: 0, levels: { l0: 1, l1: 0, l2: 0, l3: 0, l4: 0 } },
  reviewSchedule: { learningDays: 1, familiarDays: 3, masteredDays: 7, expertDays: 21, lapseDays: 1, maxDays: 60 },
  ...overrides,
})

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
})

describe('import commit completion', () => {
  it('keeps the committed wordbook and reports partial completion when category saving fails', async () => {
    const committed = wordbook()
    const commitImportDraft = vi.fn(async () => committed)
    const updateMyWordbook = vi.fn(async () => { throw new Error('category unavailable') })
    const onCreated = vi.fn()
    const onClose = vi.fn()
    const onPartial = vi.fn()

    const outcome = await commitImportedDraft({
      api: { commitImportDraft, updateMyWordbook },
      draftId: 'draft-1',
      decisions: {},
      mode: 'append',
      category: 'reading',
      onCreated,
      onClose,
      onPartial,
    })

    expect(outcome).toEqual({ wordbook: committed, categorySaved: false })
    expect(commitImportDraft).toHaveBeenCalledTimes(1)
    expect(updateMyWordbook).toHaveBeenCalledTimes(1)
    expect(onCreated).toHaveBeenCalledTimes(1)
    expect(onCreated).toHaveBeenCalledWith(committed)
    expect(onClose).not.toHaveBeenCalled()
    expect(onPartial).toHaveBeenCalledWith(committed)
  })

  it('keeps commit errors as creation errors without calling completion callbacks', async () => {
    const commitImportDraft = vi.fn(async () => { throw new Error('commit unavailable') })
    const updateMyWordbook = vi.fn(async () => wordbook({ category: 'reading' }))
    const onCreated = vi.fn()
    const onClose = vi.fn()
    const onPartial = vi.fn()

    await expect(commitImportedDraft({
      api: { commitImportDraft, updateMyWordbook },
      draftId: 'draft-1',
      decisions: {},
      mode: 'append',
      category: 'reading',
      onCreated,
      onClose,
      onPartial,
    })).rejects.toThrow('commit unavailable')
    expect(commitImportDraft).toHaveBeenCalledTimes(1)
    expect(updateMyWordbook).not.toHaveBeenCalled()
    expect(onCreated).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(onPartial).not.toHaveBeenCalled()
  })
})

describe('groupProcessingState', () => {
  it('reports queued while every processing batch waits in the FIFO queue', () => {
    expect(groupProcessingState([
      { status: 'processing', queued: true },
      { status: 'processing', queued: true },
    ])).toBe('queued')
  })

  it('reports processing while any batch is actively matching dictionary data', () => {
    expect(groupProcessingState([
      { status: 'processing', queued: true },
      { status: 'processing', queued: false },
    ])).toBe('processing')
  })

  it('reports pending once every batch is ready for confirmation', () => {
    expect(groupProcessingState([
      { status: 'pending' },
      { status: 'pending' },
    ])).toBe('pending')
  })
})

describe('import draft group summary', () => {
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
