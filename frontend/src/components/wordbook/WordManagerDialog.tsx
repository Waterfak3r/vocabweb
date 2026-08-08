import { memo, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type {
  BatchWordAction,
  BatchWordResult,
  MyWordbookWord,
  MyWordbookWordsPage,
  WorkspaceApi,
  WordLevel,
  WordStatus,
} from '../../data/workspaceApi'
import { useModalDialog } from '../../hooks/useModalDialog'
import './word-manager-dialog.css'

export type EditableWordbookItem = MyWordbookWord & {
  zhMeaning?: string
  zhMeaningSource?: 'user' | 'dictionary'
  status?: WordStatus
  level?: WordLevel
  levelReachedAt?: string
}

export type WordbookWordPatch = {
  word: string
  phonetic: string
  audioUrl?: string
  zhMeaning: string | null
  meanings: EditableWordbookItem['meanings']
  refresh: boolean
}

/** 熟练度档位显示名，索引即档位 0-4。 */
const LEVEL_NAMES = ['未学习', '初识', '熟悉', '掌握', '精通'] as const
const WORD_LEVELS: WordLevel[] = [0, 1, 2, 3, 4]
const PAGE_SIZE = 50
const SEARCH_DEBOUNCE_MS = 250
const EMPTY_LEVEL_COUNTS = { l0: 0, l1: 0, l2: 0, l3: 0, l4: 0 } as const
export type WordManagerLevelFilter = WordLevel | 'all'

/** Same fallback ladder as the wordbook decks: prefer level, else map the legacy status. */
function levelOf(entry: EditableWordbookItem): WordLevel {
  return entry.level ?? (entry.status === 'learning' ? 1 : entry.status === 'review' ? 2 : entry.status === 'mastered' ? 3 : 0)
}

type Props = {
  api: Pick<WorkspaceApi, 'listWordPage'> | null
  wordbookId: string
  title: string
  totalWords: number
  initialLevel?: WordManagerLevelFilter
  saving?: boolean
  returnFocus?: HTMLElement | null
  onClose: () => void
  onSave: (id: string, patch: WordbookWordPatch) => Promise<void>
  /** 标熟: marks the word 精通 (L4); adaptive long-term review can still schedule it later. */
  onMarkKnown?: (id: string, word: string) => Promise<void>
  onBatch: (action: BatchWordAction, ids: string[]) => Promise<BatchWordResult>
}

function meaningsToText(item: EditableWordbookItem) {
  return item.meanings
    .map((meaning) => [meaning.pos, meaning.definition, meaning.example ?? ''].join(' | '))
    .join('\n')
}

export function parseEditableMeanings(value: string): EditableWordbookItem['meanings'] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [pos = 'unknown', definition = '', ...exampleParts] = line.split('|').map((part) => part.trim())
      const example = exampleParts.join(' | ').trim()
      return {
        pos: pos || 'unknown',
        definition,
        ...(example ? { example } : {}),
      }
    })
    .filter((meaning) => meaning.pos !== 'unknown' || Boolean(meaning.definition) || Boolean(meaning.example))
}

/** Retained for lightweight filter-contract tests and offline callers. The dialog itself filters on the server. */
export function filterManagedWords(
  entries: readonly EditableWordbookItem[],
  query: string,
  level: WordManagerLevelFilter,
) {
  const normalized = query.trim().toLowerCase()
  return entries.filter((entry) => {
    if (level !== 'all' && levelOf(entry) !== level) return false
    if (!normalized) return true
    return entry.word.toLowerCase().includes(normalized)
      || entry.zhMeaning?.includes(query.trim())
      || entry.meanings.some((meaning) => meaning.definition.toLowerCase().includes(normalized))
  })
}

type WordManagerListRowProps = {
  entry: EditableWordbookItem
  active: boolean
  checked: boolean
  onOpen: (id: string) => void
  onToggle: (id: string) => void
}

const WordManagerListRow = memo(function WordManagerListRow({
  entry,
  active,
  checked,
  onOpen,
  onToggle,
}: WordManagerListRowProps) {
  const level = levelOf(entry)
  return (
    <div className={`word-manager-list-row${active ? ' selected' : ''}${checked ? ' checked' : ''}`}>
      <input type="checkbox" checked={checked} aria-label={`选择 ${entry.word}`} onChange={() => onToggle(entry.id)} />
      <button type="button" onClick={() => onOpen(entry.id)}>
        <span className="word-manager-list-head">
          <strong>{entry.word}</strong>
          <span className="word-manager-level" data-level={level}>{LEVEL_NAMES[level]}</span>
        </span>
        <small>{entry.zhMeaning || entry.meanings[0]?.definition || '暂无释义'}</small>
      </button>
    </div>
  )
})

export function WordManagerDialog({
  api,
  wordbookId,
  title,
  totalWords,
  initialLevel = 'all',
  saving = false,
  returnFocus,
  onClose,
  onSave,
  onMarkKnown,
  onBatch,
}: Props) {
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [levelFilter, setLevelFilter] = useState<WordManagerLevelFilter>(initialLevel)
  const [page, setPage] = useState(1)
  const [pageData, setPageData] = useState<MyWordbookWordsPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [reloadVersion, setReloadVersion] = useState(0)
  const [selectedId, setSelectedId] = useState('')
  const [word, setWord] = useState('')
  const [phonetic, setPhonetic] = useState('')
  const [zhMeaning, setZhMeaning] = useState('')
  const [meaningsText, setMeaningsText] = useState('')
  const [error, setError] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [batching, setBatching] = useState<BatchWordAction | null>(null)
  const [batchMessage, setBatchMessage] = useState('')
  const requestSequence = useRef(0)
  const dialogRef = useModalDialog<HTMLElement>({
    open: true,
    onClose,
    canClose: !saving && !batching,
    returnFocus,
  })

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query.trim())
      setPage(1)
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [query])

  useEffect(() => {
    const requestId = ++requestSequence.current
    let active = true
    if (!api) {
      setLoading(false)
      setLoadError('词条服务暂不可用，请稍后重试。')
      return
    }
    setLoading(true)
    setLoadError('')
    void api.listWordPage(wordbookId, {
      page,
      pageSize: PAGE_SIZE,
      ...(debouncedQuery ? { q: debouncedQuery } : {}),
      ...(levelFilter !== 'all' ? { level: levelFilter } : {}),
    }).then((next) => {
      if (!active || requestSequence.current !== requestId) return
      setPageData(next)
      if (next.page !== page) setPage(next.page)
      setSelectedId((current) => next.items.some((item) => item.id === current) ? current : next.items[0]?.id ?? '')
    }).catch(() => {
      if (active && requestSequence.current === requestId) setLoadError('词条加载失败，请重试。')
    }).finally(() => {
      if (active && requestSequence.current === requestId) setLoading(false)
    })
    return () => { active = false }
  }, [api, debouncedQuery, levelFilter, page, reloadVersion, wordbookId])

  const entries = pageData?.items ?? []
  const selected = useMemo(
    () => entries.find((entry) => entry.id === selectedId) ?? entries[0],
    [entries, selectedId],
  )
  const visibleIds = useMemo(() => entries.map((entry) => entry.id), [entries])
  const selectedVisibleCount = useMemo(
    () => visibleIds.reduce((count, id) => count + Number(selectedIds.has(id)), 0),
    [selectedIds, visibleIds],
  )
  const allVisibleSelected = visibleIds.length > 0 && selectedVisibleCount === visibleIds.length
  const levelCounts = pageData?.levelCounts ?? EMPTY_LEVEL_COUNTS
  const currentPage = pageData?.page ?? page
  const totalPages = pageData?.totalPages ?? 1
  const matchingCount = pageData?.total ?? 0
  const totalWordCount = pageData?.totalWordCount ?? totalWords

  // Key on the entry's content, not just its id: after a save, refetch the
  // current page and follow rematched dictionary fields without clobbering typing.
  const selectedFingerprint = selected ? JSON.stringify(selected) : ''
  useEffect(() => {
    if (!selected) return
    setWord(selected.word)
    setPhonetic(selected.phonetic)
    setZhMeaning(selected.zhMeaning ?? '')
    setMeaningsText(meaningsToText(selected))
    setError('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFingerprint])

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((ids) => {
      const next = new Set(ids)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setBatchMessage('')
  }, [])

  const openEntry = useCallback((id: string) => setSelectedId(id), [])

  const toggleAllVisible = useCallback(() => {
    setSelectedIds((ids) => {
      const next = new Set(ids)
      if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id))
      else visibleIds.forEach((id) => next.add(id))
      return next
    })
    setBatchMessage('')
  }, [allVisibleSelected, visibleIds])

  async function runBatch(action: BatchWordAction) {
    const ids = [...selectedIds]
    if (!ids.length || batching) return
    if (action === 'delete' && !window.confirm(`永久删除选中的 ${ids.length} 个单词及其学习记录？此操作无法恢复。`)) return
    setBatching(action)
    setBatchMessage('')
    try {
      const result = await onBatch(action, ids)
      if (action === 'delete') {
        const removed = new Set(result.succeededIds)
        setSelectedIds((current) => new Set([...current].filter((id) => !removed.has(id))))
      }
      const actionLabel = action === 'refresh-meanings' ? '更新释义' : action === 'mark-mastered' ? '标熟' : '删除'
      setBatchMessage(`${actionLabel}完成：成功 ${result.succeededIds.length} 个${result.failed.length ? `，失败 ${result.failed.length} 个` : ''}。`)
      setReloadVersion((version) => version + 1)
    } catch {
      setBatchMessage('批量操作失败，部分已完成的词条会保留；请重试剩余词条。')
      setReloadVersion((version) => version + 1)
    } finally {
      setBatching(null)
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!selected) return
    const meanings = parseEditableMeanings(meaningsText)
    if (!word.trim()) {
      setError('请输入英文单词。')
      return
    }
    setError('')
    try {
      await onSave(selected.id, {
        word: word.trim(),
        phonetic: phonetic.trim(),
        zhMeaning: zhMeaning.trim() || null,
        meanings,
        refresh: selected.word !== word.trim(),
      })
      setReloadVersion((version) => version + 1)
    } catch {
      setError('保存失败，请检查内容后重试。')
    }
  }

  async function markKnown() {
    if (!selected || !onMarkKnown) return
    setError('')
    try {
      await onMarkKnown(selected.id, selected.word)
      setReloadVersion((version) => version + 1)
    } catch {
      setError('标熟失败，请稍后重试。')
    }
  }

  return (
    <div className="workspace-modal-backdrop word-manager-backdrop" role="presentation">
      <section ref={dialogRef} className="word-manager-dialog" role="dialog" aria-modal="true" aria-labelledby="word-manager-title" tabIndex={-1}>
        <header>
          <div>
            <p>浏览词条</p>
            <h2 id="word-manager-title">{title}</h2>
          </div>
          <button type="button" className="workspace-modal-close" aria-label="关闭" disabled={saving || Boolean(batching)} onClick={onClose}>×</button>
        </header>
        <div className="word-manager-layout">
          <aside aria-busy={loading}>
            <label>
              <span className="sr-only">搜索整本词条</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`搜索整本${levelFilter === 'all' ? '' : LEVEL_NAMES[levelFilter]}词条`} />
            </label>
            <div className="word-manager-level-filters" role="group" aria-label="按熟练度筛选">
              <button
                type="button"
                className={levelFilter === 'all' ? 'active' : ''}
                aria-pressed={levelFilter === 'all'}
                onClick={() => { setLevelFilter('all'); setPage(1) }}
              >
                <span>全部</span><strong>{totalWordCount}</strong>
              </button>
              {WORD_LEVELS.map((level) => (
                <button
                  type="button"
                  key={level}
                  className={levelFilter === level ? 'active' : ''}
                  aria-pressed={levelFilter === level}
                  onClick={() => { setLevelFilter(level); setPage(1) }}
                >
                  <span>{LEVEL_NAMES[level]}</span><strong>{levelCounts[`l${level}`]}</strong>
                </button>
              ))}
            </div>
            <div className="word-manager-select-all">
              <label>
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  ref={(node) => { if (node) node.indeterminate = selectedVisibleCount > 0 && !allVisibleSelected }}
                  onChange={toggleAllVisible}
                  disabled={!entries.length || loading}
                />
                <span>全选本页</span>
              </label>
              <small>已选 {selectedIds.size} / 本页 {entries.length} / 匹配 {matchingCount} / 全部 {totalWordCount}</small>
            </div>
            {loadError && <p className="word-manager-load-error" role="alert">{loadError}</p>}
            <div className={`word-manager-list${loading ? ' loading' : ''}`}>
              {entries.map((entry) => (
                <WordManagerListRow
                  key={entry.id}
                  entry={entry}
                  active={entry.id === selected?.id}
                  checked={selectedIds.has(entry.id)}
                  onOpen={openEntry}
                  onToggle={toggleSelected}
                />
              ))}
              {loading && !pageData && <p role="status">正在加载当前页…</p>}
              {!loading && !loadError && !entries.length && <p>没有匹配的词条。</p>}
            </div>
            <nav className="word-manager-pagination" aria-label="词条分页">
              <button type="button" disabled={loading || currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</button>
              <span>第 <strong>{currentPage}</strong> / {totalPages} 页</span>
              <button type="button" disabled={loading || currentPage >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>下一页</button>
            </nav>
          </aside>
          {selected ? (
            <form onSubmit={submit}>
              <label>英文单词<input value={word} onChange={(event) => setWord(event.target.value)} /></label>
              <div className="word-manager-inline">
                <label>音标<input value={phonetic} onChange={(event) => setPhonetic(event.target.value)} placeholder="/.../" /></label>
                <label>中文释义<input value={zhMeaning} onChange={(event) => setZhMeaning(event.target.value)} placeholder="可留空" /></label>
              </div>
              <label>
                英文释义
                <textarea
                  value={meaningsText}
                  onChange={(event) => setMeaningsText(event.target.value)}
                  rows={8}
                  aria-describedby="meaning-format-hint"
                />
              </label>
              <small id="meaning-format-hint">每行格式：词性 | 英文释义 | 例句（例句可省略；未匹配词可暂时留空）</small>
              {word !== selected.word && <p className="word-manager-note">修改英文词头后，后台只会重新匹配这一条单词。</p>}
              {error && <p className="word-manager-error" role="alert">{error}</p>}
              <footer>
                {onMarkKnown && levelOf(selected) < 4 && (
                  <button
                    type="button"
                    className="word-manager-mark"
                    disabled={saving || Boolean(batching)}
                    onClick={() => { void markKnown() }}
                  >
                    标熟（不再学习）
                  </button>
                )}
                <button type="button" onClick={onClose}>取消</button>
                <button type="submit" disabled={saving || Boolean(batching)}>{saving ? '保存中…' : '保存此词条'}</button>
              </footer>
            </form>
          ) : <div className="word-manager-empty"><p>{loading ? '正在加载词条…' : loadError ? '当前页暂时无法显示。' : '当前筛选没有词条。'}</p></div>}
        </div>
        {selectedIds.size > 0 && (
          <footer className="word-manager-batch-bar">
            <span><strong>{selectedIds.size}</strong> 个词条已选</span>
            {batchMessage && <p role="status">{batchMessage}</p>}
            <div>
              <button type="button" disabled={Boolean(batching)} onClick={() => void runBatch('refresh-meanings')}>{batching === 'refresh-meanings' ? '更新中…' : '更新释义'}</button>
              <button type="button" disabled={Boolean(batching)} onClick={() => void runBatch('mark-mastered')}>{batching === 'mark-mastered' ? '标熟中…' : '批量标熟'}</button>
              <button type="button" className="danger" disabled={Boolean(batching)} onClick={() => void runBatch('delete')}>{batching === 'delete' ? '删除中…' : '批量删除'}</button>
            </div>
          </footer>
        )}
      </section>
    </div>
  )
}
