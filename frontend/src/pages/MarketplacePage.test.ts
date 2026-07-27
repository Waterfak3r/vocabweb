import { describe, expect, it } from 'vitest'
import {
  filterMarketplaceBooks,
  marketplaceCatalogQuery,
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
