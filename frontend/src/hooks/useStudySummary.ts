import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  deriveLocalStudySummary,
  getStudySummary,
  hasStudyApi,
  type StudySummary,
} from '../data/studyApi'
import type { WordbookItem } from '../domain/types'

export type StudySummarySource = 'local' | 'remote'

export type UseStudySummary = {
  summary: StudySummary
  source: StudySummarySource
  isRefreshing: boolean
  refresh: () => Promise<void>
}

/**
 * Prefer the server's cross-device learning record, then retain a useful local
 * wordbook-derived overview whenever the server is absent or unreachable.
 */
export function useStudySummary(items: readonly WordbookItem[]): UseStudySummary {
  const localSummary = useMemo(() => deriveLocalStudySummary(items), [items])
  const [remoteSummary, setRemoteSummary] = useState<StudySummary | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const refresh = useCallback(async () => {
    if (!hasStudyApi()) return

    setIsRefreshing(true)
    try {
      setRemoteSummary(await getStudySummary())
    } catch {
      // The local summary below is intentionally kept available offline.
    } finally {
      setIsRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return {
    summary: remoteSummary ?? localSummary,
    source: remoteSummary ? 'remote' : 'local',
    isRefreshing,
    refresh,
  }
}
