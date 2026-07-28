import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { WordbookItem } from '../../domain/types'
import type { BatchWordAction, BatchWordResult, WordLevel, WordStatus } from '../../data/workspaceApi'
import './word-manager-dialog.css'

export type EditableWordbookItem = WordbookItem & {
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
}

/** 熟练度档位显示名，索引即档位 0-4。 */
const LEVEL_NAMES = ['未学习', '初识', '熟悉', '掌握', '精通'] as const

/** Same fallback ladder as the wordbook decks: prefer level, else map the legacy status. */
function levelOf(entry: EditableWordbookItem): WordLevel {
  return entry.level ?? (entry.status === 'learning' ? 1 : entry.status === 'review' ? 2 : entry.status === 'mastered' ? 3 : 0)
}

type Props = {
  title: string
  entries: EditableWordbookItem[]
  saving?: boolean
  onClose: () => void
  onSave: (id: string, patch: WordbookWordPatch) => Promise<void>
  /** 标熟: marks the word 精通 (L4) and stops it appearing in study decks. Absent -> button hidden. */
  onMarkKnown?: (id: string) => Promise<void>
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

export function WordManagerDialog({ title, entries, saving = false, onClose, onSave, onMarkKnown, onBatch }: Props) {
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState(entries[0]?.id ?? '')
  const selected = entries.find((entry) => entry.id === selectedId) ?? entries[0]
  const [word, setWord] = useState(selected?.word ?? '')
  const [phonetic, setPhonetic] = useState(selected?.phonetic ?? '')
  const [audioUrl, setAudioUrl] = useState(selected?.audioUrl ?? '')
  const [zhMeaning, setZhMeaning] = useState(selected?.zhMeaning ?? '')
  const [meaningsText, setMeaningsText] = useState(selected ? meaningsToText(selected) : '')
  const [error, setError] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [batching, setBatching] = useState<BatchWordAction | null>(null)
  const [batchMessage, setBatchMessage] = useState('')

  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return entries
    return entries.filter((entry) =>
      entry.word.toLowerCase().includes(normalized)
      || entry.zhMeaning?.includes(query.trim())
      || entry.meanings.some((meaning) => meaning.definition.toLowerCase().includes(normalized)),
    )
  }, [entries, query])
  const visibleIds = visible.map((entry) => entry.id)
  const selectedVisibleCount = visibleIds.filter((id) => selectedIds.has(id)).length
  const allVisibleSelected = visibleIds.length > 0 && selectedVisibleCount === visibleIds.length

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [onClose])

  // Key on the entry's content, not just its id: after a save the parent
  // refreshes entries (same id, rematched dictionary fields) and the form must
  // follow — but a refresh returning identical data must not clobber typing.
  const selectedFingerprint = selected ? JSON.stringify(selected) : ''
  useEffect(() => {
    if (!selected) return
    setWord(selected.word)
    setPhonetic(selected.phonetic)
    setAudioUrl(selected.audioUrl ?? '')
    setZhMeaning(selected.zhMeaning ?? '')
    setMeaningsText(meaningsToText(selected))
    setError('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFingerprint])

  useEffect(() => {
    const currentIds = new Set(entries.map((entry) => entry.id))
    setSelectedIds((ids) => new Set([...ids].filter((id) => currentIds.has(id))))
  }, [entries])

  function toggleSelected(id: string) {
    setSelectedIds((ids) => {
      const next = new Set(ids)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setBatchMessage('')
  }

  function toggleAllVisible() {
    setSelectedIds((ids) => {
      const next = new Set(ids)
      if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id))
      else visibleIds.forEach((id) => next.add(id))
      return next
    })
    setBatchMessage('')
  }

  async function runBatch(action: BatchWordAction) {
    const ids = [...selectedIds]
    if (!ids.length || batching) return
    if (action === 'delete' && !window.confirm(`永久删除选中的 ${ids.length} 个单词及其学习记录？此操作无法恢复。`)) return
    setBatching(action)
    setBatchMessage('')
    try {
      const result = await onBatch(action, ids)
      if (action === 'delete') setSelectedIds((current) => new Set([...current].filter((id) => !result.succeededIds.includes(id))))
      const actionLabel = action === 'refresh-meanings' ? '更新释义' : action === 'mark-mastered' ? '标熟' : '删除'
      setBatchMessage(`${actionLabel}完成：成功 ${result.succeededIds.length} 个${result.failed.length ? `，失败 ${result.failed.length} 个` : ''}。`)
    } catch {
      setBatchMessage('批量操作失败，所选词条未全部更新。')
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
        ...(audioUrl.trim() ? { audioUrl: audioUrl.trim() } : {}),
        zhMeaning: zhMeaning.trim() || null,
        meanings,
      })
    } catch {
      setError('保存失败，请检查内容后重试。')
    }
  }

  return (
    <div className="workspace-modal-backdrop word-manager-backdrop" role="presentation">
      <section className="word-manager-dialog" role="dialog" aria-modal="true" aria-labelledby="word-manager-title">
        <header>
          <div>
            <p>浏览词条</p>
            <h2 id="word-manager-title">{title}</h2>
          </div>
          <button type="button" className="workspace-modal-close" aria-label="关闭" onClick={onClose}>×</button>
        </header>
        <div className="word-manager-layout">
          <aside>
            <label>
              <span className="sr-only">搜索词条</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索英文或释义" />
            </label>
            <div className="word-manager-select-all">
              <label>
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  ref={(node) => { if (node) node.indeterminate = selectedVisibleCount > 0 && !allVisibleSelected }}
                  onChange={toggleAllVisible}
                  disabled={!visible.length}
                />
                <span>全选当前结果</span>
              </label>
              <small>已选 {selectedIds.size} / 当前 {visible.length} / 全部 {entries.length}</small>
            </div>
            <div className="word-manager-list">
              {visible.map((entry) => (
                <div
                  key={entry.id}
                  className={`word-manager-list-row${entry.id === selected?.id ? ' selected' : ''}${selectedIds.has(entry.id) ? ' checked' : ''}`}
                >
                  <input type="checkbox" checked={selectedIds.has(entry.id)} aria-label={`选择 ${entry.word}`} onChange={() => toggleSelected(entry.id)} />
                  <button type="button" onClick={() => setSelectedId(entry.id)}>
                    <span className="word-manager-list-head">
                      <strong>{entry.word}</strong>
                      <span className="word-manager-level" data-level={levelOf(entry)}>{LEVEL_NAMES[levelOf(entry)]}</span>
                    </span>
                    <small>{entry.zhMeaning || entry.meanings[0]?.definition || '暂无释义'}</small>
                  </button>
                </div>
              ))}
              {!visible.length && <p>没有匹配的词条。</p>}
            </div>
          </aside>
          {selected ? (
            <form onSubmit={submit}>
              <label>英文单词<input value={word} onChange={(event) => setWord(event.target.value)} /></label>
              <div className="word-manager-inline">
                <label>音标<input value={phonetic} onChange={(event) => setPhonetic(event.target.value)} placeholder="/.../" /></label>
                <label>中文释义<input value={zhMeaning} onChange={(event) => setZhMeaning(event.target.value)} placeholder="可留空" /></label>
              </div>
              <label>发音地址<input value={audioUrl} onChange={(event) => setAudioUrl(event.target.value)} placeholder="https://..." /></label>
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
                    onClick={() => { void onMarkKnown(selected.id) }}
                  >
                    标熟（不再学习）
                  </button>
                )}
                <button type="button" onClick={onClose}>取消</button>
                <button type="submit" disabled={saving || Boolean(batching)}>{saving ? '保存中…' : '保存此词条'}</button>
              </footer>
            </form>
          ) : <div className="word-manager-empty"><p>当前词本还没有单词。</p></div>}
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
