import type { WordbookItem } from '../domain/types'
import type { MyWordbook } from './workspaceApi'
import { storageKey } from '../lib/storage'

export type StudySummary = {
  date: string
  /** Total saved words. Local: local items. Remote: sum of every wordbook's wordCount. */
  wordbookTotal: number
  /** New words added today (local mode only; remote leaves 0). */
  addedToday: number
  /** Review-eligible words. Local: all items. Remote: recent book's learning + review. */
  reviewDue: number
  /** Dictation-eligible words. Local: all items. Remote: recent book's studied words. */
  dictationDue: number
  /** Remote mode: number of personal wordbooks. Local mode: 0. */
  wordbookCount: number
  /** Remote mode: the most-recently-updated wordbook, else null. Local mode: null. */
  recent: {
    title: string
    /** learning + review, the review-eligible words of this book. */
    reviewDue: number
    mastered: number
    unstudied: number
  } | null
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
 * The home page renders this whenever the backend is absent, empty, or failed.
 */
export function deriveLocalStudySummary(items: readonly WordbookItem[]): StudySummary {
  const now = new Date()
  return {
    date: now.toISOString().slice(0, 10),
    wordbookTotal: items.length,
    addedToday: countItemsAddedToday(items),
    reviewDue: items.length,
    dictationDue: items.length,
    wordbookCount: 0,
    recent: null,
    updatedAt: now.toISOString(),
  }
}

/** The most-recently-updated personal wordbook, or null for an empty list. */
export function mostRecentWordbook(wordbooks: readonly MyWordbook[]): MyWordbook | null {
  let recent: MyWordbook | null = null
  for (const book of wordbooks) {
    if (!recent || book.updatedAt.localeCompare(recent.updatedAt) > 0) recent = book
  }
  return recent
}

/**
 * Real study overview from the backend wordbook system. Numbers follow the
 * word-status lifecycle: review-eligible = learning + review (both need review),
 * dictation-eligible = every studied word (total minus never-studied).
 */
export function summarizeMyWordbooks(wordbooks: readonly MyWordbook[]): StudySummary {
  const now = new Date()
  const recent = mostRecentWordbook(wordbooks)
  const totalWords = wordbooks.reduce((sum, book) => sum + book.wordCount, 0)
  const reviewDue = recent ? recent.progress.review + recent.progress.learning : 0
  const dictationDue = recent ? recent.wordCount - recent.progress.unstudied : 0
  return {
    date: now.toISOString().slice(0, 10),
    wordbookTotal: totalWords,
    addedToday: 0,
    reviewDue,
    dictationDue,
    wordbookCount: wordbooks.length,
    recent: recent
      ? {
          title: recent.title,
          reviewDue,
          mastered: recent.progress.mastered,
          unstudied: recent.progress.unstudied,
        }
      : null,
    updatedAt: recent?.updatedAt ?? now.toISOString(),
  }
}
