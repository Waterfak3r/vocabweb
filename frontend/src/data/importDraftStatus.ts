import type { ImportDraftTaskSummary } from './workspaceApi'

export const IMPORT_DRAFTS_CHANGED_EVENT = 'vocab:import-drafts-changed'
export const IMPORT_DRAFT_QUERY_PARAM = 'importDraft'

export type ImportDraftBadge = ImportDraftTaskSummary & {
  kind: 'processing' | 'ready'
  percent: number
  taskCount: number
}

function timestamp(value: string) {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/** Selects the most useful unfinished import to expose in the global header. */
export function selectImportDraftBadge(tasks: readonly ImportDraftTaskSummary[]): ImportDraftBadge | null {
  if (!tasks.length) return null
  const ordered = [...tasks].sort((left, right) => {
    if (left.status !== right.status) return left.status === 'processing' ? -1 : 1
    return timestamp(right.updatedAt) - timestamp(left.updatedAt)
  })
  const active = ordered[0]
  if (!active) return null
  const percent = active.totalEntries
    ? Math.round((active.completedEntries / active.totalEntries) * 100)
    : active.status === 'pending' ? 100 : 0
  return {
    ...active,
    kind: active.status === 'processing' ? 'processing' : 'ready',
    percent: Math.max(0, Math.min(100, percent)),
    taskCount: tasks.length,
  }
}

/** Lets the header refresh immediately after create, commit, or delete. */
export function notifyImportDraftsChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(IMPORT_DRAFTS_CHANGED_EVENT))
}
