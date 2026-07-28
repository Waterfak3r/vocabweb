import type { LookupErrorCode, WordEntry } from '../domain/types'

/**
 * Dictionary lookup seam. UI never talks to a concrete provider.
 * The composition root selects our backend or the development fallback.
 */
export interface WordRepository {
  /** Resolve one normalized English word or phrase. "Not found" resolves to null — never throws. */
  lookup(word: string): Promise<WordEntry | null>
}

/** Infrastructure failure (network, 5xx, timeout, bad payload). */
export class LookupError extends Error {
  readonly code: LookupErrorCode

  constructor(code: LookupErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'LookupError'
    this.code = code
  }
}
