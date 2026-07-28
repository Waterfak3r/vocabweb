import { describe, expect, it } from 'vitest'
import { MAX_IMPORT_ENTRIES, parseWordbookText, validateImportFile, validateImportText } from './wordbookImport'

describe('wordbook import parser', () => {
  it('parses one-to-five CSV columns and preserves phrases', () => {
    expect(parseWordbookText('a lot of,phrase,a large amount,许多,We had a lot of time.\ncontribute').entries).toEqual([
      { line: 1, raw: 'a lot of,phrase,a large amount,许多,We had a lot of time.', word: 'a lot of', pos: 'phrase', enDefinition: 'a large amount', zhMeaning: '许多', example: 'We had a lot of time.', status: 'ready' },
      { line: 2, raw: 'contribute', word: 'contribute', status: 'ready' },
    ])
  })

  it('accepts conventional sb./sth. placeholders without allowing arbitrary punctuation', () => {
    const parsed = parseWordbookText([
      'agree with sb.',
      'be devoted to sth.',
      'be habitual to sb.',
      'be linked to sth.',
      'ordinary.',
    ].join('\n'))
    expect(parsed.entries.map((entry) => entry.status))
      .toEqual(['ready', 'ready', 'ready', 'ready', 'invalid'])
  })

  it('accepts ellipsis slots and normalizes genuine hyphen variants', () => {
    const parsed = parseWordbookText([
      'connect...with...',
      'provide sb. with …',
      'well ‑ known',
      'two..dots',
      'word—word',
    ].join('\n'))
    expect(parsed.entries.map(({ word, status }) => ({ word, status }))).toEqual([
      { word: 'connect...with...', status: 'ready' },
      { word: 'provide sb. with ...', status: 'ready' },
      { word: 'well-known', status: 'ready' },
      { word: 'two..dots', status: 'invalid' },
      { word: 'word—word', status: 'invalid' },
    ])
  })

  it('accepts a controlled trailing abbreviation and normalizes its spacing', () => {
    const parsed = parseWordbookText([
      'initial public offering(IPO),n.,,公司上市；首次公开发行公司股份',
      'research and development(R&D),abbr.,,研究与开发',
    ].join('\n'))
    expect(parsed.entries.map(({ word, status }) => ({ word, status }))).toEqual([
      { word: 'initial public offering (ipo)', status: 'ready' },
      { word: 'research and development (r&d)', status: 'ready' },
    ])
  })

  it('understands quoted commas and flags invalid and duplicate rows without dropping them', () => {
    const parsed = parseWordbookText('achieve,verb,\"reach, gain\",达到\nachieve,verb,accomplish,达成\n123,unknown,not a word')
    expect(parsed.acceptedCount).toBe(1)
    expect(parsed.entries.map((entry) => entry.status)).toEqual(['ready', 'duplicate', 'invalid'])
    expect(parsed.entries[0]?.enDefinition).toBe('reach, gain')
  })

  it('rejects the legacy whitespace format and malformed or over-wide CSV rows', () => {
    const parsed = parseWordbookText('resilient 有韧性的\nword,\"unterminated\nword,noun,definition,释义,example,extra')
    expect(parsed.entries.map((entry) => entry.status)).toEqual(['invalid', 'invalid', 'invalid'])
  })

  it('calculates continuation draft batches from accepted words only', () => {
    const content = Array.from({ length: MAX_IMPORT_ENTRIES + 1 }, (_, index) => `word${index}`).join('\n')
    // Digits make the entries intentionally invalid; valid words verify the batching contract below.
    expect(parseWordbookText(content).batchCount).toBe(0)
    const words = Array.from({ length: MAX_IMPORT_ENTRIES + 1 }, (_, index) => `word${String.fromCharCode(97 + Math.floor(index / 26))}${String.fromCharCode(97 + (index % 26))}`).join('\n')
    expect(parseWordbookText(words).batchCount).toBe(2)
  })

  it('enforces the allowed extensions and one megabyte cap', () => {
    expect(validateImportFile({ name: 'words.csv', size: 1 })).toBeNull()
    expect(validateImportFile({ name: 'words.xlsx', size: 1 })).toContain('CSV')
    expect(validateImportFile({ name: 'words.docx', size: 1024 * 1024 + 1 })).toContain('1MB')
    expect(validateImportFile({ name: 'words.md', size: 1024 })).toBeNull()
    expect(validateImportText('中'.repeat(400_000))).toContain('1MB')
    expect(validateImportText('word 释义')).toBeNull()
  })
})
