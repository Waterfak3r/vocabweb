import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { WordbookItem } from '../../domain/types'
import './word-manager-dialog.css'

export type EditableWordbookItem = WordbookItem & {
  zhMeaning?: string
  zhMeaningSource?: 'user' | 'dictionary'
}

export type WordbookWordPatch = {
  word: string
  phonetic: string
  audioUrl?: string
  zhMeaning: string | null
  meanings: EditableWordbookItem['meanings']
}

type Props = {
  title: string
  entries: EditableWordbookItem[]
  saving?: boolean
  onClose: () => void
  onSave: (id: string, patch: WordbookWordPatch) => Promise<void>
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
    .filter((meaning) => meaning.definition)
}

export function WordManagerDialog({ title, entries, saving = false, onClose, onSave }: Props) {
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState(entries[0]?.id ?? '')
  const selected = entries.find((entry) => entry.id === selectedId) ?? entries[0]
  const [word, setWord] = useState(selected?.word ?? '')
  const [phonetic, setPhonetic] = useState(selected?.phonetic ?? '')
  const [audioUrl, setAudioUrl] = useState(selected?.audioUrl ?? '')
  const [zhMeaning, setZhMeaning] = useState(selected?.zhMeaning ?? '')
  const [meaningsText, setMeaningsText] = useState(selected ? meaningsToText(selected) : '')
  const [error, setError] = useState('')

  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return entries
    return entries.filter((entry) =>
      entry.word.toLowerCase().includes(normalized)
      || entry.zhMeaning?.includes(query.trim())
      || entry.meanings.some((meaning) => meaning.definition.toLowerCase().includes(normalized)),
    )
  }, [entries, query])

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
            <p>管理词条</p>
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
            <div className="word-manager-list">
              {visible.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={entry.id === selected?.id ? 'selected' : ''}
                  onClick={() => setSelectedId(entry.id)}
                >
                  <strong>{entry.word}</strong>
                  <small>{entry.zhMeaning || entry.meanings[0]?.definition || '暂无释义'}</small>
                </button>
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
                <button type="button" onClick={onClose}>取消</button>
                <button type="submit" disabled={saving}>{saving ? '保存中…' : '保存此词条'}</button>
              </footer>
            </form>
          ) : <div className="word-manager-empty"><p>当前词本还没有单词。</p></div>}
        </div>
      </section>
    </div>
  )
}
