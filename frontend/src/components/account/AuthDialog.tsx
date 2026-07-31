import { useEffect, useRef, useState, type FormEvent } from 'react'
import { WorkspaceApiError } from '../../data/workspaceApi'

export type AuthMode = 'login' | 'register'

type Props = {
  mode: AuthMode
  onModeChange: (mode: AuthMode) => void
  onClose: () => void
  login: (username: string, password: string) => Promise<unknown>
  register: (username: string, password: string) => Promise<unknown>
  returnFocus?: HTMLElement | null
}

/** Contract: 2-20 chars of letters, digits, underscore, hyphen, or 中文. */
const USERNAME_RE = /^[A-Za-z0-9_一-龥-]{2,20}$/
const PASSWORD_MIN = 8
const PASSWORD_MAX = 72

/** Maps a thrown backend error to the Chinese message the contract prescribes. */
export function mapAuthError(error: unknown): string {
  if (error instanceof WorkspaceApiError) {
    if (error.code === 'USERNAME_TAKEN') return '用户名已被占用'
    if (error.code === 'REGISTRATION_DISABLED') return '当前站点未开放注册'
    if (error.code === 'ACTIVE_SESSION_ACCOUNT_CONFLICT') return '请先退出当前账号，再登录其他账号'
    if (error.code === 'CLIENT_ID_ACCOUNT_CONFLICT' || error.code === 'CLIENT_ID_ALREADY_REGISTERED') return '当前浏览器数据已绑定其他账号，请刷新后重试'
    if (error.status === 429) return '尝试次数过多，请稍后再试'
    if (error.status === 401) return '用户名或密码不正确'
    if (error.status === 400) return '用户名或密码格式不正确'
  }
  const message = error instanceof Error ? error.message : ''
  const status = message.match(/\((\d{3})\)/)?.[1]
  if (status === '409') return '用户名已被占用'
  if (status === '401') return '用户名或密码不正确'
  if (status === '400') return '用户名或密码格式不正确'
  return '网络错误，请稍后重试'
}

/**
 * Login / register modal reusing the workspace modal visual language. On success
 * the passed login/register (from useAuth) persist the account clientId and
 * reload the page, so this dialog never has to close itself on success.
 */
const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'

export function AuthDialog({ mode, onModeChange, onClose, login, register, returnFocus }: Props) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [touched, setTouched] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const usernameRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(
    returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null),
  )

  const usernameValid = USERNAME_RE.test(username)
  const passwordValid = password.length >= PASSWORD_MIN && password.length <= PASSWORD_MAX
  const canSubmit = usernameValid && passwordValid && !submitting

  // Lock body scroll and restore the invoking control when the dialog unmounts.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
      previousFocusRef.current?.focus()
    }
  }, [])

  useEffect(() => {
    usernameRef.current?.focus()
  }, [])

  // Keep keyboard focus inside the modal. An in-flight credential request is
  // intentionally not dismissible, so its eventual result remains visible.
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
    if (!usernameValid || !passwordValid || submitting) return
    setSubmitting(true)
    setError('')
    try {
      if (mode === 'login') await login(username, password)
      else await register(username, password)
      // Success reloads the page from within useAuth; leave the button disabled.
    } catch (caught) {
      setError(mapAuthError(caught))
      setSubmitting(false)
    }
  }

  function switchMode(next: AuthMode) {
    setError('')
    setTouched(false)
    setPassword('')
    onModeChange(next)
  }

  const title = mode === 'login' ? '登录' : '注册'

  return (
    <div
      className="workspace-modal-backdrop auth-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (!submitting && event.target === event.currentTarget) onClose()
      }}
    >
      <section ref={dialogRef} className="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-dialog-title">
        <header>
          <div>
            <p>{mode === 'login' ? '欢迎回来' : '创建账号'}</p>
            <h2 id="auth-dialog-title">{title}</h2>
          </div>
          <button type="button" className="workspace-modal-close" aria-label="关闭" disabled={submitting} onClick={onClose}>×</button>
        </header>
        <form onSubmit={submit} noValidate>
          <label>
            用户名
            <input
              ref={usernameRef}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              onBlur={() => setTouched(true)}
              autoComplete="username"
              maxLength={20}
              aria-invalid={touched && !usernameValid}
              aria-describedby={touched && username && !usernameValid ? 'auth-username-hint' : undefined}
            />
          </label>
          {touched && username && !usernameValid && (
            <p id="auth-username-hint" className="auth-hint">用户名需为 2-20 位字母、数字、下划线、连字符或中文。</p>
          )}
          <label>
            密码
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              onBlur={() => setTouched(true)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              maxLength={PASSWORD_MAX}
              aria-invalid={touched && !passwordValid}
              aria-describedby={touched && password && !passwordValid ? 'auth-password-hint' : undefined}
            />
          </label>
          {touched && password && !passwordValid && (
            <p id="auth-password-hint" className="auth-hint">密码至少 8 位。</p>
          )}
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button type="submit" className="auth-submit" disabled={!canSubmit}>
            {submitting ? '处理中…' : title}
          </button>
          <p className="auth-switch">
            {mode === 'login' ? '还没有账号？' : '已有账号？'}
            <button type="button" disabled={submitting} onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}>
              {mode === 'login' ? '注册' : '登录'}
            </button>
          </p>
        </form>
      </section>
    </div>
  )
}
