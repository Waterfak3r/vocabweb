import type { LookupErrorCode, WordEntry } from '../domain/types'

/**
 * Dictionary lookup seam. UI never talks to a concrete provider.
 * Later the backend implements this contract and the factory swaps it in.
 */
export interface WordRepository {
  /** Resolve a single English lemma. "Not found" resolves to null — never throws. */
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
