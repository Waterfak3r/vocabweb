import { describe, expect, it } from 'vitest'
import contract from '../../../resources/normalize-contract.json'
import { isValidWordQuery, normalizeWord } from './normalize'

// The backend asserts the same table (backend/test/normalize-contract.test.ts),
// so any divergence between the two normalizeWord copies fails CI.
describe('normalize contract shared with the backend', () => {
  it('matches every case in resources/normalize-contract.json', () => {
    expect(contract.cases.length).toBeGreaterThan(0)
    for (const { input, normalized, valid } of contract.cases) {
      expect(normalizeWord(input), `normalizeWord(${JSON.stringify(input)})`).toBe(normalized)
      expect(isValidWordQuery(normalized), `isValidWordQuery(${JSON.stringify(normalized)})`).toBe(valid)
    }
  })
})
