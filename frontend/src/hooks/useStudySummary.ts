import { useCallback, useMemo } from 'react'
import { deriveLocalStudySummary, type StudySummary } from '../data/studyApi'
import type { WordbookItem } from '../domain/types'

export type StudySummarySource = 'local' | 'remote'

export type UseStudySummary = {
  summary: StudySummary
  source: StudySummarySource
  isRefreshing: boolean
  refresh: () => Promise<void>
}

/**
 * The dashboard API is wordbook-scoped, so the home page deliberately shows
 * only values that can be proved from the local wordbook. The workspace page
 * owns remote dashboard synchronization for the selected wordbook.
 */
export function useStudySummary(items: readonly WordbookItem[]): UseStudySummary {
  const localSummary = useMemo(() => deriveLocalStudySummary(items), [items])
  const refresh = useCallback(async () => undefined, [])

  return {
    summary: localSummary,
    source: 'local',
    isRefreshing: false,
    refresh,
  }
}
