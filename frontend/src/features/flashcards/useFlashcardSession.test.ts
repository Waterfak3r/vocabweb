import { describe, expect, it } from 'vitest'
import { nextQueueAfterVerdict } from './useFlashcardSession'

describe('flashcard verdict queue', () => {
  it('completes a recognized card after one honest judgment', () => {
    expect(nextQueueAfterVerdict(['alpha', 'bravo'], 'know')).toEqual(['bravo'])
  })

  it('moves an unknown card to the back without duplicating it', () => {
    expect(nextQueueAfterVerdict(['alpha', 'bravo', 'charlie'], 'unknown')).toEqual(['bravo', 'charlie', 'alpha'])
    expect(nextQueueAfterVerdict(['alpha'], 'unknown')).toEqual(['alpha'])
  })
})
