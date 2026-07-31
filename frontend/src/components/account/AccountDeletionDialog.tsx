import { useEffect, useRef, useState, type FormEvent } from 'react'
import { getWorkspaceApi } from '../../data/workspaceApi'
import { rotateStudyClientId } from '../../data/studyApi'
import { Button } from '../ui/Button'
import { TextField } from '../ui/TextField'
import { canDeleteAccount, mapAccountDeletionError } from './accountForms'

type Props = {
  username: string
  onClose: () => void
}

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'

export function AccountDeletionDialog({ username, onClose }: Props) {
  const [confirmation, setConfirmation] = useState('')
  const [password, setPassword] = useState('')
  const [touched, setTouched] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const dialogRef = useRef<HTMLElement>(null)
  const confirmationRef = useRef<HTMLInputElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  )
  const ready = canDeleteAccount(username, confirmation, password)

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    confirmationRef.current?.focus()
    return () => {
      document.body.style.overflow = previousOverflow
      previousFocusRef.current?.focus()
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!submitting) onClose()
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
    setTouched(true)
    if (!ready || submitting) return
    const api = getWorkspaceApi()
    if (!api) {
      setError('当前部署未启用账号服务。')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      await api.deleteAccount(password)
      rotateStudyClientId()
      window.location.assign('/')
    } catch (caught) {
      setError(mapAccountDeletionError(caught))
      setSubmitting(false)
    }
  }

  return (
    <div
      className="account-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (!submitting && event.target === event.currentTarget) onClose()
      }}
    >
      <section
        ref={dialogRef}
        className="account-delete-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-delete-title"
        aria-describedby="account-delete-description"
      >
        <header>
          <div>
            <p>危险操作</p>
            <h2 id="account-delete-title">永久注销账号</h2>
          </div>
          <button type="button" aria-label="关闭" disabled={submitting} onClick={onClose}>×</button>
        </header>
        <div className="account-delete-warning" id="account-delete-description">
          <strong>此操作无法撤销</strong>
          <p>私人词书、学习记录、会话和发布内容将被永久删除，留言会被匿名化。</p>
        </div>
        <form onSubmit={submit} noValidate>
          <TextField
            ref={confirmationRef}
            label={`输入用户名“${username}”确认`}
            value={confirmation}
            onChange={setConfirmation}
            onBlur={() => setTouched(true)}
            autoComplete="off"
            error={touched && confirmation !== username ? '用户名不一致。' : undefined}
          />
          <TextField
            label="当前密码"
            type="password"
            value={password}
            onChange={setPassword}
            onBlur={() => setTouched(true)}
            autoComplete="current-password"
            error={touched && (password.length < 8 || password.length > 72) ? '请输入有效的当前密码。' : undefined}
          />
          {error && <p className="account-form-error" role="alert">{error}</p>}
          <footer>
            <Button variant="secondary" disabled={submitting} onClick={onClose}>取消</Button>
            <Button variant="danger" type="submit" disabled={!ready || submitting}>
              {submitting ? '正在注销…' : '永久注销'}
            </Button>
          </footer>
        </form>
      </section>
    </div>
  )
}
