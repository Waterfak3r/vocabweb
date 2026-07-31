import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { characterMask, spellingCharacters } from './DictationPrompt'
import { DictationPrompt } from './DictationPrompt'

describe('spellingCharacters', () => {
  it('marks only the letters that differ at the same position', () => {
    expect(spellingCharacters('recieve', 'receive')).toEqual([
      { character: 'r', incorrect: false },
      { character: 'e', incorrect: false },
      { character: 'c', incorrect: false },
      { character: 'i', incorrect: true },
      { character: 'e', incorrect: true },
      { character: 'v', incorrect: false },
      { character: 'e', incorrect: false },
    ])
  })

  it('marks characters typed beyond the expected word', () => {
    expect(spellingCharacters('wordx', 'word').at(-1)).toEqual({ character: 'x', incorrect: true })
  })
})

describe('characterMask', () => {
  it('hides letters while preserving apostrophes and hyphens', () => {
    expect(characterMask("mother-in-law")).toBe('□□□□□□-□□-□□□')
    expect(characterMask("don't")).toBe("□□□'□")
  })
})

describe('DictationPrompt actions', () => {
  it('renders a skip action while the learner is answering', () => {
    vi.stubGlobal('window', { localStorage: { getItem: () => null } })
    try {
      const html = renderToStaticMarkup(createElement(DictationPrompt, {
        item: {
          id: 'word-1',
          word: 'resilient',
          phonetic: '/rɪˈzɪliənt/',
          meanings: [{ pos: 'adjective', definition: 'Able to recover.' }],
          source: 'user',
          addedAt: '2026-01-01T00:00:00.000Z',
        },
        answer: '',
        onAnswerChange: () => undefined,
        onSubmit: () => undefined,
        onSkip: () => undefined,
        onNext: () => undefined,
        onPlay: () => undefined,
        phase: 'prompt',
        grade: null,
        isLast: false,
      }))

      expect(html).toContain('>跳过</button>')
      expect(html).toContain('>提交</button>')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
