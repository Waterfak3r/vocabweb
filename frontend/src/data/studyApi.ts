import type { WordbookItem } from '../domain/types'
import { storageKey } from '../lib/storage'

export type StudySummary = {
  date: string
  wordbookTotal: number
  addedToday: number
  lookupCount: number
  review: {
    due: number
    completedToday: number
  }
  dictation: {
    due: number
    completedToday: number
  }
  dailyGoal: {
    target: number
    completed: number
  }
  updatedAt: string
}

const CLIENT_ID_KEY = storageKey('client-id', 1)

function newClientId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

/** A stable anonymous identifier lets the backend keep a learner's daily record. */
export function getStudyClientId() {
  try {
    const existing = window.localStorage.getItem(CLIENT_ID_KEY)?.trim()
    if (existing) return existing

    const clientId = newClientId()
    window.localStorage.setItem(CLIENT_ID_KEY, clientId)
    return clientId
  } catch {
    // Privacy-mode storage can fail; retaining an in-memory ID still keeps the request valid.
    return newClientId()
  }
}

function countItemsAddedToday(items: readonly WordbookItem[]) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  return items.filter((item) => {
    const addedAt = new Date(item.addedAt).getTime()
    return Number.isFinite(addedAt) && addedAt >= today.getTime() && addedAt < tomorrow.getTime()
  }).length
}

/**
 * Honest offline fallback: only derive values the local wordbook can prove.
 * Completion counters and goals remain zero and are not presented as activity.
 */
export function deriveLocalStudySummary(items: readonly WordbookItem[]): StudySummary {
  const now = new Date()
  return {
    date: now.toISOString().slice(0, 10),
    wordbookTotal: items.length,
    addedToday: countItemsAddedToday(items),
    lookupCount: 0,
    review: { due: items.length, completedToday: 0 },
    dictation: { due: items.length, completedToday: 0 },
    dailyGoal: { target: 0, completed: 0 },
    updatedAt: now.toISOString(),
  }
}
