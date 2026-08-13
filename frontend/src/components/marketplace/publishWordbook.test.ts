import { describe, expect, it } from 'vitest'
import {
  findPublishedUploadForWordbook,
  hasOpenVisibilityChanges,
  isSnapshotSourceLocked,
  MARKETPLACE_TITLE_MAX_LENGTH,
  marketplaceTitleError,
} from './publishWordbook'
import type { CatalogWordbook } from '../../data/workspaceApi'

function upload(partial: Partial<CatalogWordbook> & Pick<CatalogWordbook, 'id'>): CatalogWordbook {
  return {
    title: partial.id,
    description: '',
    author: '墨客',
    exams: [],
    goals: [],
    rating: 0,
    uses: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    shareCode: '',
    wordCount: 10,
    favoriteCount: 0,
    favorited: false,
    added: false,
    uploaded: true,
    ...partial,
  }
}

describe('publish wordbook helpers', () => {
  it('keeps marketplace display titles within the card-oriented limit', () => {
    expect(MARKETPLACE_TITLE_MAX_LENGTH).toBe(40)
    expect(marketplaceTitleError('词'.repeat(40))).toBe('')
    expect(marketplaceTitleError('词'.repeat(41))).toContain('40')
    expect(marketplaceTitleError('   ')).toContain('请填写')
  })

  it('locks only less-visible choices while a public upload has open suggestions', () => {
    expect(hasOpenVisibilityChanges('public', 2)).toBe(true)
    expect(hasOpenVisibilityChanges('public', 0)).toBe(false)
    expect(hasOpenVisibilityChanges('unlisted', 2)).toBe(false)
    expect(hasOpenVisibilityChanges(undefined, 2)).toBe(true)
  })

  it('locks an existing upload to its active source but allows repairing a missing source', () => {
    const wordbooks = [{ id: 'source-a' }, { id: 'source-b' }]
    expect(isSnapshotSourceLocked('source-a', wordbooks)).toBe(true)
    expect(isSnapshotSourceLocked('deleted-source', wordbooks)).toBe(false)
    expect(isSnapshotSourceLocked(undefined, wordbooks)).toBe(false)
  })

  it('matches a personal wordbook to its published snapshot without guessing by title', () => {
    const uploads = [
      upload({ id: 'other', title: '阅读积累', sourceWordbookId: 'book-other' }),
      upload({ id: 'mine', title: '阅读积累', sourceWordbookId: 'book-mine', updatedAt: '2026-02-01T00:00:00.000Z' }),
      upload({ id: 'older-mine', title: '阅读积累', sourceWordbookId: 'book-mine', updatedAt: '2026-01-15T00:00:00.000Z' }),
    ]
    expect(findPublishedUploadForWordbook(uploads, 'book-mine')?.id).toBe('mine')
    expect(findPublishedUploadForWordbook(uploads, 'book-unknown')).toBeUndefined()
  })
})
