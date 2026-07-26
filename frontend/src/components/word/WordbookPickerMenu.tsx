import { useEffect, useRef, useState } from 'react'
import type { MyWordbook } from '../../data/workspaceApi'

/** Sentinel busy id used while a brand-new wordbook is being created. */
export const CREATE_WORDBOOK_BUSY = '__create__'

export type WordbookPickerMenuProps = {
  /** null while the list has not been loaded yet. */
  wordbooks: MyWordbook[] | null
  loading: boolean
  /** Non-empty when the list could not be loaded. */
  error: string
  /** Wordbooks this word was already collected into during this session. */
  savedWordbookIds: ReadonlySet<string>
  /** A wordbook id, or CREATE_WORDBOOK_BUSY, while a write is in flight. */
  busyId: string | null
  onPick: (book: MyWordbook) => void
  onCreate: (title: string) => void
  /** Escape inside the menu; the trigger's owner restores focus. */
  onClose: () => void
}

/** A small popover that lists the learner's wordbooks and can create a new one. */
export function WordbookPickerMenu({
  wordbooks,
  loading,
  error,
  savedWordbookIds,
  busyId,
  onPick,
  onCreate,
  onClose,
}: WordbookPickerMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const createInputRef = useRef<HTMLInputElement>(null)
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')

  // Move focus into the menu when it opens so the keyboard lands somewhere useful.
  useEffect(() => {
    menuRef.current?.querySelector<HTMLElement>('button, input')?.focus()
  }, [])

  useEffect(() => {
    if (creating) createInputRef.current?.focus()
  }, [creating])

  const busy = busyId !== null

  function submitCreate() {
    const trimmed = title.trim()
    if (!trimmed || busy) return
    onCreate(trimmed)
  }

  return (
    <div
      ref={menuRef}
      className="collect-menu"
      role="menu"
      aria-label="选择单词本"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onClose()
        }
      }}
    >
      {loading && (
        <p className="collect-menu-status" role="status">
          正在加载单词本…
        </p>
      )}

      {!loading && error && (
        <p className="collect-menu-status collect-menu-error" role="alert">
          {error}
        </p>
      )}

      {!loading && !error && wordbooks && wordbooks.length === 0 && (
        <p className="collect-menu-status">还没有单词本，新建一个吧。</p>
      )}

      {!loading &&
        !error &&
        wordbooks?.map((book) => {
          const saved = savedWordbookIds.has(book.id)
          return (
            <button
              key={book.id}
              type="button"
              role="menuitem"
              className="collect-menu-item"
              disabled={saved || busy}
              onClick={() => onPick(book)}
            >
              <span className="collect-menu-item-title">{book.title}</span>
              <span className="collect-menu-item-meta">
                {saved ? '已收入' : busyId === book.id ? '收入中…' : `${book.wordCount} 词`}
              </span>
            </button>
          )
        })}

      <div className="collect-menu-create">
        {creating ? (
          <form
            className="collect-menu-create-form"
            onSubmit={(event) => {
              event.preventDefault()
              submitCreate()
            }}
          >
            <input
              ref={createInputRef}
              className="collect-menu-input"
              type="text"
              value={title}
              maxLength={60}
              placeholder="新单词本名称"
              aria-label="新单词本名称"
              onChange={(event) => setTitle(event.target.value)}
            />
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !title.trim()}>
              {busyId === CREATE_WORDBOOK_BUSY ? '创建中…' : '创建并收入'}
            </button>
          </form>
        ) : (
          <button
            type="button"
            role="menuitem"
            className="collect-menu-item collect-menu-new"
            disabled={busy}
            onClick={() => setCreating(true)}
          >
            ＋ 新建单词本
          </button>
        )}
      </div>
    </div>
  )
}
