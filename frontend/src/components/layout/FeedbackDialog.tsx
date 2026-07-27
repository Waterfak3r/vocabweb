import { useEffect, useRef, useState, type FormEvent } from 'react'
import { getEngagementApi, type FeedbackType } from '../../data/engagementApi'

type Props = {
  onClose: () => void
  returnFocus?: HTMLElement | null
}

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'

export function FeedbackDialog({ onClose, returnFocus }: Props) {
  const [type, setType] = useState<FeedbackType>('suggestion')
  const [message, setMessage] = useState('')
  const [contact, setContact] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')
  const dialogRef = useRef<HTMLElement>(null)
  const messageRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    const previousFocus = returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    document.body.style.overflow = 'hidden'
    messageRef.current?.focus()
    return () => {
      document.body.style.overflow = previousOverflow
      previousFocus?.focus()
    }
  }, [returnFocus])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) {
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, submitting])

  async function submit(event: FormEvent) {
    event.preventDefault()
    const body = message.trim()
    if (!body || body.length > 1000 || contact.trim().length > 200 || submitting) return
    const api = getEngagementApi()
    if (!api) {
      setError('当前未连接服务器，暂时无法提交留言。')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      await api.submitFeedback({
        type,
        message: body,
        ...(contact.trim() ? { contact: contact.trim() } : {}),
        page: `${window.location.pathname}${window.location.search}`,
      })
      setSubmitted(true)
    } catch {
      setError('留言提交失败，请检查网络后重试。')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="workspace-modal-backdrop feedback-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (!submitting && event.target === event.currentTarget) onClose()
      }}
    >
      <section ref={dialogRef} className="feedback-dialog" role="dialog" aria-modal="true" aria-labelledby="feedback-title">
        <header>
          <div>
            <p>告诉我们你的想法</p>
            <h2 id="feedback-title">留言</h2>
          </div>
          <button type="button" className="workspace-modal-close" aria-label="关闭留言" disabled={submitting} onClick={onClose}>×</button>
        </header>
        {submitted ? (
          <div className="feedback-success" role="status">
            <span aria-hidden="true">✓</span>
            <h3>留言已收到</h3>
            <p>感谢你的反馈，我们会认真查看。</p>
            <button type="button" className="auth-submit" onClick={onClose}>关闭</button>
          </div>
        ) : (
          <form onSubmit={submit} noValidate>
            <label>
              留言类型
              <select value={type} onChange={(event) => setType(event.target.value as FeedbackType)}>
                <option value="suggestion">功能建议</option>
                <option value="bug">问题反馈</option>
                <option value="other">其他</option>
              </select>
            </label>
            <label>
              留言内容
              <textarea
                ref={messageRef}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                maxLength={1000}
                rows={6}
                placeholder="请描述你遇到的问题或希望改进的地方"
                required
              />
            </label>
            <p className="feedback-count">{message.length} / 1000</p>
            <label>
              联系方式 <small>选填</small>
              <input
                value={contact}
                onChange={(event) => setContact(event.target.value)}
                maxLength={200}
                placeholder="邮箱、QQ 或其他联系方式"
              />
            </label>
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button type="submit" className="auth-submit" disabled={!message.trim() || submitting}>
              {submitting ? '正在提交…' : '提交留言'}
            </button>
          </form>
        )}
      </section>
    </div>
  )
}
