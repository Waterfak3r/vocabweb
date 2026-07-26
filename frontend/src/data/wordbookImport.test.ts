import { describe, expect, it } from 'vitest'
import { MAX_IMPORT_ENTRIES, parseWordbookText, validateImportFile, validateImportText } from './wordbookImport'

describe('wordbook import parser', () => {
  it('keeps the first token as English and all remaining text as the Chinese meaning', () => {
    expect(parseWordbookText('resilient 有韧性的；能快速恢复的\ncontribute').entries).toEqual([
      { line: 1, raw: 'resilient 有韧性的；能快速恢复的', word: 'resilient', zhMeaning: '有韧性的；能快速恢复的', status: 'ready' },
      { line: 2, raw: 'contribute', word: 'contribute', status: 'ready' },
    ])
  })

  it('understands Markdown lists and flags invalid and duplicate rows without dropping them', () => {
    const parsed = parseWordbookText('- achieve 达到\n* achieve 达成\n123 not a word')
    expect(parsed.acceptedCount).toBe(1)
    expect(parsed.entries.map((entry) => entry.status)).toEqual(['ready', 'duplicate', 'invalid'])
  })

  it('calculates continuation draft batches from accepted words only', () => {
    const content = Array.from({ length: MAX_IMPORT_ENTRIES + 1 }, (_, index) => `word${index}`).join('\n')
    // Digits make the entries intentionally invalid; valid words verify the batching contract below.
    expect(parseWordbookText(content).batchCount).toBe(0)
    const words = Array.from({ length: MAX_IMPORT_ENTRIES + 1 }, (_, index) => `word${String.fromCharCode(97 + Math.floor(index / 26))}${String.fromCharCode(97 + (index % 26))}`).join('\n')
    expect(parseWordbookText(words).batchCount).toBe(2)
  })

  it('enforces the allowed extensions and one megabyte cap', () => {
    expect(validateImportFile({ name: 'words.csv', size: 1 })).toContain('TXT')
    expect(validateImportFile({ name: 'words.docx', size: 1024 * 1024 + 1 })).toContain('1MB')
    expect(validateImportFile({ name: 'words.md', size: 1024 })).toBeNull()
    expect(validateImportText('中'.repeat(400_000))).toContain('1MB')
    expect(validateImportText('word 释义')).toBeNull()
  })
})
