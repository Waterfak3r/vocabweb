import { useCallback, useEffect, useRef, useState } from 'react'
import { getWorkspaceApi, hasWorkspaceApi, type MyWordbook } from '../../data/workspaceApi'
import { selectHasWord, useWordbook } from '../../data/wordbookStore'
import { notifyStudySummaryChanged } from '../../hooks/useStudySummary'
import { readStorage, storageKey, writeStorage } from '../../lib/storage'
import type { WordEntry } from '../../domain/types'
import { Button } from '../ui/Button'
import { CREATE_WORDBOOK_BUSY, WordbookPickerMenu } from './WordbookPickerMenu'

export type AddToWordbookButtonProps = {
  entry: WordEntry
}

/** Routes to the backend picker when a workspace API is configured, else the local store. */
export function AddToWordbookButton({ entry }: AddToWordbookButtonProps) {
  return hasWorkspaceApi() ? <BackendAddToWordbook entry={entry} /> : <LocalAddToWordbook entry={entry} />
}

/* ── Local (API-less) mode — unchanged legacy behavior ─────────────────────── */

function LocalAddToWordbook({ entry }: AddToWordbookButtonProps) {
  const saved = useWordbook(selectHasWord(entry.word))
  const add = useWordbook((state) => state.add)
  const [announcement, setAnnouncement] = useState('')

  function handleAdd() {
    if (add(entry)) {
      setAnnouncement(`已把 ${entry.word} 放入单词本。`)
    }
  }

  return (
    <span className="add-to-wordbook">
      <Button variant={saved ? 'ghost' : 'primary'} onClick={handleAdd} disabled={saved}>
        {saved ? '已收入' : '收入单词本'}
      </Button>
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </span>
  )
}

/* ── Backend mode — pick / create a real wordbook ──────────────────────────── */

const LAST_COLLECT_KEY = storageKey('last-collect-wordbook', 1)

type RememberedTarget = { id: string; title: string }

function readRemembered(): RememberedTarget | null {
  const raw = readStorage<unknown>(LAST_COLLECT_KEY)
  if (raw && typeof raw === 'object') {
    const { id, title } = raw as Record<string, unknown>
    if (typeof id === 'string' && id && typeof title === 'string') return { id, title }
  }
  return null
}

function ellipsize(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max)}…` : value
}

function BackendAddToWordbook({ entry }: AddToWordbookButtonProps) {
  const containerRef = useRef<HTMLSpanElement>(null)
  const openerRef = useRef<HTMLButtonElement>(null)

  const [open, setOpen] = useState(false)
  const [wordbooks, setWordbooks] = useState<MyWordbook[] | null>(null)
  const [loadingList, setLoadingList] = useState(false)
  const [listError, setListError] = useState('')
  const [savedIds, setSavedIds] = useState<Set<string>>(() => new Set())
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const [remembered, setRemembered] = useState<RememberedTarget | null>(() => readRemembered())

  const restoreFocusRef = useRef(false)
  const closeMenu = useCallback((returnFocus: boolean) => {
    setOpen(false)
    if (returnFocus) restoreFocusRef.current = true
  }, [])

  // Restore focus after the commit, not synchronously: a successful first collect
  // swaps the single trigger for the split button, unmounting the old element —
  // focusing it before the swap would drop keyboard focus to <body>.
  useEffect(() => {
    if (!open && restoreFocusRef.current) {
      restoreFocusRef.current = false
      openerRef.current?.focus()
    }
  })

  const loadList = useCallback(async () => {
    const api = getWorkspaceApi()
    if (!api) return
    setLoadingList(true)
    setListError('')
    try {
      const books = await api.listMyWordbooks()
      setWordbooks(books)
      // The remembered target may have been trashed or renamed since it was saved.
      setRemembered((prev) => {
        if (!prev) return prev
        const match = books.find((book) => book.id === prev.id)
        if (!match) {
          writeStorage(LAST_COLLECT_KEY, null)
          return null
        }
        if (match.title === prev.title) return prev
        const fresh = { id: match.id, title: match.title }
        writeStorage(LAST_COLLECT_KEY, fresh)
        return fresh
      })
    } catch {
      setListError('无法加载单词本，请重试。')
    } finally {
      setLoadingList(false)
    }
  }, [])

  function openMenu() {
    setActionError('')
    setOpen(true)
    if (wordbooks === null && !loadingList) void loadList()
  }

  function toggleMenu() {
    if (open) closeMenu(false)
    else openMenu()
  }

  const collectInto = useCallback(
    async (book: { id: string; title: string }, busyKey: string = book.id) => {
      const api = getWorkspaceApi()
      if (!api) return
      setBusyId(busyKey)
      setActionError('')
      try {
        const { duplicate } = await api.addWordToWordbook(book.id, {
          word: entry.word,
          zhMeaning: entry.zhMeaning,
        })
        setSavedIds((prev) => {
          const next = new Set(prev)
          next.add(book.id)
          return next
        })
        const target = { id: book.id, title: book.title }
        setRemembered(target)
        writeStorage(LAST_COLLECT_KEY, target)
        setAnnouncement(
          duplicate
            ? `「${entry.word}」已在「${book.title}」中。`
            : `已把「${entry.word}」收入「${book.title}」。`,
        )
        notifyStudySummaryChanged()
        closeMenu(true)
      } catch (error) {
        // A 404 means the target wordbook is gone (trashed or purged) — retrying
        // can never succeed, so drop the dead remembered target and refresh.
        if (error instanceof Error && error.message.includes('(404)')) {
          setRemembered((prev) => {
            if (prev?.id !== book.id) return prev
            writeStorage(LAST_COLLECT_KEY, null)
            return null
          })
          setWordbooks((prev) => (prev ? prev.filter((item) => item.id !== book.id) : prev))
          setActionError(`「${book.title}」已被删除，请重新选择单词本。`)
        } else {
          setActionError('收入失败，请重试。')
        }
      } finally {
        setBusyId(null)
      }
    },
    [entry.word, entry.zhMeaning, closeMenu],
  )

  const handleCreate = useCallback(
    async (title: string) => {
      const api = getWorkspaceApi()
      const trimmed = title.trim()
      if (!api || !trimmed) return
      setBusyId(CREATE_WORDBOOK_BUSY)
      setActionError('')
      let book: MyWordbook
      try {
        book = await api.createMyWordbook({ title: trimmed })
      } catch {
        setActionError('创建失败，请重试。')
        setBusyId(null)
        return
      }
      setWordbooks((prev) => (prev ? [book, ...prev] : [book]))
      await collectInto({ id: book.id, title: book.title }, CREATE_WORDBOOK_BUSY)
    },
    [collectInto],
  )

  // Dismiss the popover on any click outside the trigger + menu.
  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  const savedInRemembered = remembered ? savedIds.has(remembered.id) : false
  const busy = busyId !== null

  return (
    <span className="add-to-wordbook collect-wrap" ref={containerRef}>
      {remembered ? (
        <span className="collect-split">
          <Button
            variant={savedInRemembered ? 'ghost' : 'primary'}
            onClick={() => {
              if (!savedInRemembered) void collectInto(remembered)
            }}
            disabled={savedInRemembered || busy}
          >
            {savedInRemembered
              ? `已收入「${ellipsize(remembered.title, 12)}」`
              : `收入「${ellipsize(remembered.title, 12)}」`}
          </Button>
          <button
            ref={openerRef}
            type="button"
            className="collect-chevron"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label="选择其他单词本"
            disabled={busy}
            onClick={toggleMenu}
          >
            <span aria-hidden="true">▾</span>
          </button>
        </span>
      ) : (
        <button
          ref={openerRef}
          type="button"
          className="btn btn-primary btn-md"
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={busy}
          onClick={toggleMenu}
        >
          收入单词本
        </button>
      )}

      {open && (
        <WordbookPickerMenu
          wordbooks={wordbooks}
          loading={loadingList}
          error={listError}
          savedWordbookIds={savedIds}
          busyId={busyId}
          onPick={(book) => void collectInto(book)}
          onCreate={(title) => void handleCreate(title)}
          onClose={() => closeMenu(true)}
        />
      )}

      {actionError && (
        <span className="collect-error" role="alert">
          {actionError}
        </span>
      )}
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </span>
  )
}
