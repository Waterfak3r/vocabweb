import { describe, expect, it } from 'vitest'
import { parseEditableMeanings } from './WordManagerDialog'

describe('parseEditableMeanings', () => {
  it('keeps definitions and optional examples line by line', () => {
    expect(parseEditableMeanings('noun | a test | This is a test.\nverb | to examine')).toEqual([
      { pos: 'noun', definition: 'a test', example: 'This is a test.' },
      { pos: 'verb', definition: 'to examine' },
    ])
  })

  it('drops blank and definition-less rows', () => {
    expect(parseEditableMeanings('\nverb |\n | usable definition')).toEqual([
      { pos: 'unknown', definition: 'usable definition' },
    ])
  })
})
