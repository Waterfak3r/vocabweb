import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE = [
  'a[href]',
  'button:not(:disabled)',
  'input:not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

type ModalDialogOptions = {
  open: boolean
  onClose: () => void
  canClose?: boolean
  returnFocus?: HTMLElement | null
}

function focusableElements(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter((element) => (
      !element.hidden
      && !element.closest('[hidden], [aria-hidden="true"]')
      && element.getClientRects().length > 0
    ))
}

/** Shared keyboard, scroll-lock, initial-focus and focus-return behavior for modal dialogs. */
export function useModalDialog<T extends HTMLElement>({ open, onClose, canClose = true, returnFocus }: ModalDialogOptions): RefObject<T | null> {
  const dialogRef = useRef<T>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)
  const canCloseRef = useRef(canClose)
  onCloseRef.current = onClose
  canCloseRef.current = canClose

  useEffect(() => {
    if (!open) return

    const dialog = dialogRef.current
    if (!dialog) return
    const activeElement = document.activeElement
    returnFocusRef.current = returnFocus ?? (
      activeElement instanceof HTMLElement && !dialog.contains(activeElement)
        ? activeElement
        : null
    )

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusFrame = window.requestAnimationFrame(() => {
      const initial = dialog.querySelector<HTMLElement>('[data-modal-autofocus]')
        ?? focusableElements(dialog)[0]
        ?? dialog
      initial.focus()
    })

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        if (canCloseRef.current) onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return

      const focusable = focusableElements(dialog)
      if (!focusable.length) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const current = document.activeElement
      if (!dialog.contains(current)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      } else if (event.shiftKey && current === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && current === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      const returnFocus = returnFocusRef.current
      window.requestAnimationFrame(() => {
        if (returnFocus?.isConnected) returnFocus.focus()
      })
    }
  }, [open])

  return dialogRef
}
