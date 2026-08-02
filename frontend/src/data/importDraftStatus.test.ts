import { describe, expect, it } from 'vitest'
import type { ImportDraftTaskSummary } from './workspaceApi'
import { selectImportDraftBadge } from './importDraftStatus'

function task(overrides: Partial<ImportDraftTaskSummary> = {}): ImportDraftTaskSummary {
  return {
    groupId: 'group-a',
    anchorId: 'draft-a-1',
    title: '四千词导入',
    status: 'processing',
    batchCount: 8,
    totalBatches: 8,
    completedBatches: 3,
    totalEntries: 4_000,
    completedEntries: 1_500,
    problemCount: 0,
    nextProcessingDraftId: 'draft-a-4',
    updatedAt: '2026-08-02T08:00:00.000Z',
    ...overrides,
  }
}

describe('global import draft badge', () => {
  it('keeps a processing task visible and calculates whole-group progress', () => {
    expect(selectImportDraftBadge([task()])).toMatchObject({
      kind: 'processing',
      percent: 38,
      taskCount: 1,
      anchorId: 'draft-a-1',
    })
  })

  it('prioritizes active processing over a newer ready task and counts both tasks', () => {
    const badge = selectImportDraftBadge([
      task({ groupId: 'group-ready', anchorId: 'ready-1', status: 'pending', completedEntries: 4_000, completedBatches: 8, updatedAt: '2026-08-02T09:00:00.000Z' }),
      task(),
    ])
    expect(badge).toMatchObject({ kind: 'processing', groupId: 'group-a', taskCount: 2 })
    expect(selectImportDraftBadge([])).toBeNull()
  })

  it('turns a completed group into a static pending-confirmation badge', () => {
    expect(selectImportDraftBadge([task({ status: 'pending', completedEntries: 4_000, completedBatches: 8, nextProcessingDraftId: undefined })])).toMatchObject({
      kind: 'ready',
      percent: 100,
    })
  })
})
