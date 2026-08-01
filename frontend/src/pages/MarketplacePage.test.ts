import { describe, expect, it } from 'vitest'
import {
  filterMarketplaceBooks,
  isSnapshotSourceLocked,
  marketplaceCatalogQuery,
  marketplaceDetailHref,
  marketplaceTitleError,
  MARKETPLACE_TITLE_MAX_LENGTH,
  parseMarketplaceCollection,
  readMarketplaceUrlState,
  writeMarketplaceUrlState,
  type MarketplaceBook,
} from './MarketplacePage'

function book(
  id: string,
  exams: string[],
  goals: string[],
  wordCount: number,
): MarketplaceBook {
  return {
    id,
    title: `${id} title`,
    description: `${id} description`,
    author: '墨客',
    wordCount,
    rating: 0,
    learners: '0人使用',
    category: goals[0] ?? exams[0] ?? '全部',
    exam: exams[0] ?? '',
    tone: 'blue',
    shortLabel: id,
    uploaded: false,
    added: false,
    shareCode: '',
    exams,
    goals,
  }
}

describe('MarketplacePage catalog filtering', () => {
  it('keeps marketplace display titles within the card-oriented limit', () => {
    expect(MARKETPLACE_TITLE_MAX_LENGTH).toBe(40)
    expect(marketplaceTitleError('词'.repeat(40))).toBe('')
    expect(marketplaceTitleError('词'.repeat(41))).toContain('40')
    expect(marketplaceTitleError('   ')).toContain('请填写')
  })

  it('locks an existing upload to its active source but allows repairing a missing source', () => {
    const wordbooks = [{ id: 'source-a' }, { id: 'source-b' }]
    expect(isSnapshotSourceLocked('source-a', wordbooks)).toBe(true)
    expect(isSnapshotSourceLocked('deleted-source', wordbooks)).toBe(false)
    expect(isSnapshotSourceLocked(undefined, wordbooks)).toBe(false)
  })

  it('supports direct favorite/upload collection URLs and safely falls back', () => {
    expect(parseMarketplaceCollection('favorites')).toBe('favorites')
    expect(parseMarketplaceCollection('uploads')).toBe('uploads')
    expect(parseMarketplaceCollection('unknown')).toBe('all')
  })

  it('round-trips search, filters, sort and view through the URL and carries them into details', () => {
    const state = {
      query: 'academic writing',
      category: '写作',
      examFilters: ['IELTS', 'TOEFL'],
      goalFilters: ['写作'],
      sort: 'latest' as const,
      view: 'list' as const,
    }
    const params = writeMarketplaceUrlState(new URLSearchParams('collection=favorites&focus=book-1'), state)
    expect(readMarketplaceUrlState(params)).toEqual(state)
    expect(params.get('collection')).toBe('favorites')
    expect(params.get('focus')).toBe('book-1')

    const detail = new URL(marketplaceDetailHref('book/1', params.toString()), 'https://example.test')
    expect(detail.pathname).toBe('/marketplace/book%2F1')
    expect(detail.searchParams.get('from')).toBe(params.toString())
  })

  it('narrows a single selection server-side but never lets multi-select OR get cropped', () => {
    expect(marketplaceCatalogQuery(['IELTS'], ['阅读'], 'popular')).toEqual({
      exam: 'IELTS',
      goal: '阅读',
      sort: 'hot',
    })
    expect(marketplaceCatalogQuery(['IELTS', 'TOEFL'], ['阅读', '写作'], 'latest')).toEqual({
      sort: 'newest',
    })
  })

  it('uses OR within a filter group, supports secondary tags, and preserves server hot order', () => {
    const serverHotOrder = [
      book('toefl-hot', ['TOEFL'], ['听力', '阅读'], 10),
      book('ielts-large', ['IELTS'], ['写作'], 5_000),
      book('gre-hidden', ['GRE'], ['口语'], 100),
    ]

    const filtered = filterMarketplaceBooks(
      serverHotOrder,
      '',
      '全部',
      ['IELTS', 'TOEFL'],
      [],
    )
    expect(filtered.map(({ id }) => id)).toEqual(['toefl-hot', 'ielts-large'])
    expect(filtered.map(({ wordCount }) => wordCount)).toEqual([10, 5_000])

    expect(filterMarketplaceBooks(serverHotOrder, '', '阅读', [], []).map(({ id }) => id))
      .toEqual(['toefl-hot'])
  })
})
