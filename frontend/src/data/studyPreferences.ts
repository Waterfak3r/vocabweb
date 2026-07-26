import { storageKey } from '../lib/storage'

export type MeaningPreference = 'zh' | 'en'
export type StudyModeKey = 'new' | 'review' | 'dictation'

export type StudyDisplayPreferences = {
  meaningPreference: MeaningPreference
  showExamples: boolean
  showPhonetic: boolean
}

export type WordbookStudyPreferences = {
  plan: {
    newWords: number
    dictation: number
  }
  modes: {
    new: StudyDisplayPreferences
    review: StudyDisplayPreferences
    dictation: StudyDisplayPreferences & {
      underlineMistakes: boolean
    }
  }
}

const PREFERENCES_KEY = storageKey('study-preferences', 1)

export const DEFAULT_STUDY_PREFERENCES: WordbookStudyPreferences = {
  plan: {
    newWords: 20,
    dictation: 15,
  },
  modes: {
    new: {
      meaningPreference: 'zh',
      showExamples: true,
      showPhonetic: true,
    },
    review: {
      meaningPreference: 'zh',
      showExamples: true,
      showPhonetic: true,
    },
    dictation: {
      meaningPreference: 'zh',
      showExamples: true,
      showPhonetic: true,
      underlineMistakes: true,
    },
  },
}

type StoredPreferences = Record<string, WordbookStudyPreferences>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function boundedCount(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(999, Math.round(value)))
    : fallback
}

function displayPreferences(
  value: unknown,
  fallback: StudyDisplayPreferences,
): StudyDisplayPreferences {
  if (!isRecord(value)) return { ...fallback }
  return {
    meaningPreference: value.meaningPreference === 'en' || value.meaningPreference === 'zh'
      ? value.meaningPreference
      : fallback.meaningPreference,
    showExamples: typeof value.showExamples === 'boolean'
      ? value.showExamples
      : fallback.showExamples,
    showPhonetic: typeof value.showPhonetic === 'boolean'
      ? value.showPhonetic
      : fallback.showPhonetic,
  }
}

export function normalizeStudyPreferences(value: unknown): WordbookStudyPreferences {
  if (!isRecord(value)) return structuredClone(DEFAULT_STUDY_PREFERENCES)
  const plan = isRecord(value.plan) ? value.plan : {}
  const modes = isRecord(value.modes) ? value.modes : {}
  const dictation = displayPreferences(modes.dictation, DEFAULT_STUDY_PREFERENCES.modes.dictation)
  return {
    plan: {
      newWords: boundedCount(plan.newWords, DEFAULT_STUDY_PREFERENCES.plan.newWords),
      dictation: boundedCount(plan.dictation, DEFAULT_STUDY_PREFERENCES.plan.dictation),
    },
    modes: {
      new: displayPreferences(modes.new, DEFAULT_STUDY_PREFERENCES.modes.new),
      review: displayPreferences(modes.review, DEFAULT_STUDY_PREFERENCES.modes.review),
      dictation: {
        ...dictation,
        underlineMistakes: isRecord(modes.dictation)
          && typeof modes.dictation.underlineMistakes === 'boolean'
          ? modes.dictation.underlineMistakes
          : DEFAULT_STUDY_PREFERENCES.modes.dictation.underlineMistakes,
      },
    },
  }
}

function readAll(storage: Pick<Storage, 'getItem'>): StoredPreferences {
  try {
    const parsed = JSON.parse(storage.getItem(PREFERENCES_KEY) ?? '{}') as unknown
    if (!isRecord(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed).map(([wordbookId, preferences]) => [
        wordbookId,
        normalizeStudyPreferences(preferences),
      ]),
    )
  } catch {
    return {}
  }
}

export function readStudyPreferences(
  wordbookId: string,
  storage: Pick<Storage, 'getItem'> = window.localStorage,
) {
  return readAll(storage)[wordbookId] ?? structuredClone(DEFAULT_STUDY_PREFERENCES)
}

export function writeStudyPreferences(
  wordbookId: string,
  preferences: WordbookStudyPreferences,
  storage: Pick<Storage, 'getItem' | 'setItem'> = window.localStorage,
) {
  try {
    const all = readAll(storage)
    all[wordbookId] = normalizeStudyPreferences(preferences)
    storage.setItem(PREFERENCES_KEY, JSON.stringify(all))
  } catch (error) {
    // Storage may be unavailable in privacy mode; the in-memory UI still works.
    console.warn('学习偏好未能保存到本地存储', error)
  }
}

