import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { CatalogWordChange } from '../../data/workspaceApi'
import type { WordEntry } from '../../domain/types'
import { CatalogDiff, changedCatalogFields, diffStats } from './CatalogDiff'

const entry = (overrides: Partial<WordEntry> = {}): WordEntry => ({
  word: 'alpha',
  phonetic: '/alpha/',
  meanings: [{ pos: 'noun', definition: 'first letter' }],
  source: 'user',
  zhMeaning: '甲',
  zhMeaningSource: 'user',
  ...overrides,
})

describe('CatalogDiff shared review semantics', () => {
  it('maps add, delete, and update to stable green/red statistics', () => {
    const changes: CatalogWordChange[] = [
      { kind: 'add', key: 'beta', after: entry({ word: 'beta' }) },
      { kind: 'delete', key: 'gamma', before: entry({ word: 'gamma' }) },
      { kind: 'update', key: 'alpha', before: entry(), after: entry({ zhMeaning: '阿尔法' }) },
    ]
    expect(diffStats(changes)).toEqual({ additions: 1, deletions: 1, updates: 1, changedWords: 3 })
    const markup = renderToStaticMarkup(createElement(CatalogDiff, { changes }))
    expect(markup).toContain('+ 新增')
    expect(markup).toContain('- 删除')
    expect(markup).toContain('± 修改')
    expect(markup).toContain('catalog-diff-side--before')
    expect(markup).toContain('catalog-diff-side--after')
    expect(markup).toContain('aria-label="新增词条：beta"')
    expect(markup).toContain('aria-label="删除词条：gamma"')
  })

  it('renders only changed update fields while keeping the word as neutral context', () => {
    const before = entry()
    const after = entry({
      phonetic: '/ˈælfə/',
      meanings: [{ pos: 'noun', definition: 'the first item' }],
    })
    expect(changedCatalogFields(before, after).map((field) => field.key)).toEqual(['phonetic', 'meanings'])
    const markup = renderToStaticMarkup(createElement(CatalogDiff, {
      changes: [{ kind: 'update', key: 'alpha', before, after }],
    }))
    expect(markup).toContain('<h3>alpha</h3>')
    expect(markup).toContain('音标')
    expect(markup).toContain('英文释义')
    expect(markup).not.toContain('<dt>内容来源</dt>')
    expect(markup).toContain('- 旧值')
    expect(markup).toContain('+ 新值')
  })
})

