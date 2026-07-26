import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { deriveLocalStudySummary, summarizeMyWordbooks, type StudySummary } from '../data/studyApi'
import { getWorkspaceApi, hasWorkspaceApi } from '../data/workspaceApi'
import type { WordbookItem } from '../domain/types'

export type StudySummarySource = 'local' | 'remote'

export type UseStudySummary = {
  summary: StudySummary
  source: StudySummarySource
  isRefreshing: boolean
  refresh: () => Promise<void>
}

/**
 * A tiny module-level notifier so components that mutate backend wordbooks
 * (e.g. AddToWordbookButton) can nudge every mounted summary to re-fetch
 * without threading a callback through the whole tree.
 */
const subscribers = new Set<() => void>()

export function notifyStudySummaryChanged() {
  for (const notify of [...subscribers]) notify()
}

/**
 * Study overview for the home sidebar.
 *
 * With a backend configured it fetches the personal wordbooks, treats the
 * most-recently-updated one as "最近学习词本", and reports real progress.
 * When the backend is absent, returns nothing, or fails, it falls back to the
 * exact honest numbers the local wordbook can prove.
 */
export function useStudySummary(items: readonly WordbookItem[]): UseStudySummary {
  const localSummary = useMemo(() => deriveLocalStudySummary(items), [items])
  const [remote, setRemote] = useState<StudySummary | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const activeRef = useRef(true)
  const runIdRef = useRef(0)

  const refresh = useCallback(async () => {
    const api = hasWorkspaceApi() ? getWorkspaceApi() : null
    if (!api) {
      setRemote(null)
      return
    }
    const runId = (runIdRef.current += 1)
    const isCurrent = () => activeRef.current && runId === runIdRef.current
    setIsRefreshing(true)
    try {
      const wordbooks = await api.listMyWordbooks()
      if (!isCurrent()) return
      // Empty list falls back to the local rendering, per the honest-fallback rule.
      setRemote(wordbooks.length > 0 ? summarizeMyWordbooks(wordbooks) : null)
    } catch {
      if (isCurrent()) setRemote(null)
    } finally {
      if (isCurrent()) setIsRefreshing(false)
    }
  }, [])

  useEffect(() => {
    activeRef.current = true
    void refresh()
    const notify = () => { void refresh() }
    subscribers.add(notify)
    return () => {
      activeRef.current = false
      subscribers.delete(notify)
    }
  }, [refresh])

  const useRemote = remote !== null
  return {
    summary: useRemote ? remote : localSummary,
    source: useRemote ? 'remote' : 'local',
    isRefreshing,
    refresh,
  }
}
