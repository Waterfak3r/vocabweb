import { useEffect, useState } from 'react'
import {
  IMPORT_DRAFTS_CHANGED_EVENT,
  selectImportDraftBadge,
  type ImportDraftBadge,
} from '../data/importDraftStatus'
import { getWorkspaceApi } from '../data/workspaceApi'

const PROCESSING_POLL_MS = 5_000
const READY_POLL_MS = 15_000
const IDLE_POLL_MS = 30_000
const ERROR_RETRY_MS = 5_000
const RESUME_COOLDOWN_MS = 15_000

/** Keeps import progress alive in the app shell after its modal has closed. */
export function useImportDraftBadge(identity?: string) {
  const api = getWorkspaceApi()
  const [badge, setBadge] = useState<ImportDraftBadge | null>(null)

  useEffect(() => {
    if (!api) {
      setBadge(null)
      return
    }

    let active = true
    let running = false
    let rerun = false
    let timer: number | undefined
    const lastResumeAt = new Map<string, number>()

    const schedule = (delay: number) => {
      if (!active) return
      if (timer !== undefined) window.clearTimeout(timer)
      timer = window.setTimeout(() => { void refresh() }, delay)
    }

    const refresh = async () => {
      if (!active) return
      if (running) {
        rerun = true
        return
      }
      running = true
      let delay = ERROR_RETRY_MS
      try {
        const tasks = await api.listImportDraftTasks()
        if (!active) return
        const nextBadge = selectImportDraftBadge(tasks)
        setBadge(nextBadge)
        delay = nextBadge?.kind === 'processing'
          ? PROCESSING_POLL_MS
          : nextBadge ? READY_POLL_MS : IDLE_POLL_MS

        // The backend normally owns the queue. This idempotent nudge also resumes a
        // persisted processing draft after a backend restart while the modal is closed.
        const resumeId = tasks.find((task) => task.status === 'processing' && task.nextProcessingDraftId)?.nextProcessingDraftId
        if (resumeId) {
          const now = Date.now()
          const lastAttempt = lastResumeAt.get(resumeId) ?? 0
          if (now - lastAttempt >= RESUME_COOLDOWN_MS) {
            lastResumeAt.set(resumeId, now)
            void api.processImportDraft(resumeId).catch(() => lastResumeAt.delete(resumeId))
          }
        }
      } catch {
        // Retain the last known badge during a transient network failure.
      } finally {
        running = false
        if (!active) return
        if (rerun) {
          rerun = false
          schedule(0)
        } else {
          schedule(delay)
        }
      }
    }

    const refreshNow = () => {
      if (timer !== undefined) window.clearTimeout(timer)
      void refresh()
    }
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refreshNow()
    }

    window.addEventListener(IMPORT_DRAFTS_CHANGED_EVENT, refreshNow)
    window.addEventListener('focus', refreshNow)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    void refresh()

    return () => {
      active = false
      if (timer !== undefined) window.clearTimeout(timer)
      window.removeEventListener(IMPORT_DRAFTS_CHANGED_EVENT, refreshNow)
      window.removeEventListener('focus', refreshNow)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [api, identity])

  return badge
}
