import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { AuthDialog, type AuthMode } from '../account/AuthDialog'
import { useAuth } from '../../hooks/useAuth'
import { useTheme } from '../../hooks/useTheme'
import { FeedbackDialog } from './FeedbackDialog'

const NAVIGATION = [
  { to: '/', label: '查词', icon: 'search', end: true },
  { to: '/marketplace', label: '单词广场', icon: 'grid' },
  { to: '/wordbook', label: '我的单词本', icon: 'book' },
]

function NavIcon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m15.5 15.5 4 4" />
      </>
    ),
    book: (
      <>
        <rect x="4.5" y="5" width="15" height="14" rx="2" />
        <path d="M8 5v14M11 9h5M11 13h5" />
      </>
    ),
    grid: (
      <>
        <rect x="4.5" y="4.5" width="6" height="6" rx="1" />
        <rect x="13.5" y="4.5" width="6" height="6" rx="1" />
        <rect x="4.5" y="13.5" width="6" height="6" rx="1" />
        <rect x="13.5" y="13.5" width="6" height="6" rx="1" />
      </>
    ),
    account: (
      <>
        <circle cx="12" cy="8" r="3.25" />
        <path d="M5.25 20a6.75 6.75 0 0 1 13.5 0" />
      </>
    ),
    feedback: (
      <>
        <path d="M5 5.5h14v10H10l-4.5 3v-3H5z" />
        <path d="M8.5 9h7M8.5 12h4.5" />
      </>
    ),
    donation: (
      <>
        <path d="M12 20s-7-4.2-7-9.3A3.7 3.7 0 0 1 11.7 8 3.7 3.7 0 0 1 19 10.7C19 15.8 12 20 12 20Z" />
        <path d="M12 8v7M9.5 10.5h5" />
      </>
    ),
  }

  return (
    <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  )
}

export function SiteHeader() {
  const [accountOpen, setAccountOpen] = useState(false)
  const [authMode, setAuthMode] = useState<AuthMode | null>(null)
  const [logoutError, setLogoutError] = useState('')
  const [loggingOut, setLoggingOut] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [donationOpen, setDonationOpen] = useState(false)
  const [donationImageFailed, setDonationImageFailed] = useState(false)
  const accountMenuRef = useRef<HTMLDivElement>(null)
  const accountTriggerRef = useRef<HTMLButtonElement>(null)
  const feedbackTriggerRef = useRef<HTMLButtonElement>(null)
  const donationMenuRef = useRef<HTMLDivElement>(null)
  const donationTriggerRef = useRef<HTMLButtonElement>(null)
  const { user, loading, login, register, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const donationImageUrl = import.meta.env.VITE_DONATION_IMAGE_URL?.trim()

  function openAuth(mode: AuthMode) {
    setLogoutError('')
    setAccountOpen(false)
    setAuthMode(mode)
  }

  useEffect(() => {
    if (!accountOpen) return
    const closeOutside = (event: PointerEvent) => {
      if (!accountMenuRef.current?.contains(event.target as Node)) setAccountOpen(false)
    }
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setAccountOpen(false)
      accountTriggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', closeOutside)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [accountOpen])

  useEffect(() => {
    if (!donationOpen) return
    const closeOutside = (event: PointerEvent) => {
      if (!donationMenuRef.current?.contains(event.target as Node)) {
        setDonationOpen(false)
        donationTriggerRef.current?.blur()
      }
    }
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setDonationOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [donationOpen])

  function focusMenuItem(position: 'first' | 'last') {
    requestAnimationFrame(() => {
      const items = accountMenuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)')
      if (!items?.length) return
      items[position === 'first' ? 0 : items.length - 1]?.focus()
    })
  }

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    setAccountOpen(true)
    focusMenuItem(event.key === 'ArrowDown' ? 'first' : 'last')
  }

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(accountMenuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])
    if (!items.length) return
    const current = items.indexOf(document.activeElement as HTMLElement)
    let next = current
    if (event.key === 'ArrowDown') next = (current + 1) % items.length
    else if (event.key === 'ArrowUp') next = (current - 1 + items.length) % items.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = items.length - 1
    else return
    event.preventDefault()
    items[next]?.focus()
  }

  async function handleLogout() {
    setLoggingOut(true)
    setLogoutError('')
    try {
      await logout()
    } catch {
      setLogoutError('退出失败，请检查网络后重试。')
      setLoggingOut(false)
    }
  }

  return (
    <header className="site-header">
      <NavLink className="brand" to="/" aria-label="墨水词典 Vocab IELTS 首页">
        <span className="brand-mark" aria-hidden="true">
          墨
        </span>
        <span className="brand-name">WeCreate Vocab</span>
      </NavLink>

      <nav className="main-nav" aria-label="主导航">
        {NAVIGATION.map(({ to, label, icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              isActive ? 'nav-link active' : 'nav-link'
            }
          >
            <NavIcon name={icon} />
            {label}
          </NavLink>
        ))}
        <button
          ref={feedbackTriggerRef}
          type="button"
          className="nav-link nav-action"
          onClick={() => setFeedbackOpen(true)}
        >
          <NavIcon name="feedback" />
          留言
        </button>
        <div ref={donationMenuRef} className={`donation-menu${donationOpen ? ' open' : ''}`}>
          <button
            ref={donationTriggerRef}
            type="button"
            className="nav-link nav-action donation-trigger"
            aria-expanded={donationOpen}
            aria-haspopup="dialog"
            onClick={() => setDonationOpen((open) => !open)}
          >
            <NavIcon name="donation" />
            打赏
          </button>
          <div className="donation-popover" role="dialog" aria-label="打赏">
            <p>感谢支持</p>
            {donationImageUrl && !donationImageFailed ? (
              <img src={donationImageUrl} alt="打赏二维码" onError={() => setDonationImageFailed(true)} />
            ) : (
              <div className="donation-placeholder" role="img" aria-label="打赏码待配置">
                <span aria-hidden="true">赏</span>
                <small>打赏码待配置</small>
              </div>
            )}
          </div>
        </div>
        <button
          type="button"
          className="nav-link theme-toggle"
          aria-label={theme === 'dark' ? '切换到白天模式' : '切换到黑夜模式'}
          aria-pressed={theme === 'dark'}
          title={theme === 'dark' ? '切换到白天模式' : '切换到黑夜模式'}
          onClick={toggleTheme}
        >
          <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
            {theme === 'dark' ? (
              <>
                <circle cx="12" cy="12" r="4.5" />
                <path d="M12 2.5v2.5M12 19v2.5M2.5 12h2.5M19 12h2.5M5 5l1.8 1.8M17.2 17.2 19 19M19 5l-1.8 1.8M6.8 17.2 5 19" />
              </>
            ) : (
              <path d="M20.4 14.5A8.5 8.5 0 0 1 9.5 3.6a8.5 8.5 0 1 0 10.9 10.9Z" />
            )}
          </svg>
        </button>
        <div ref={accountMenuRef} className="account-menu">
          <button
            ref={accountTriggerRef}
            className="nav-link account-trigger"
            type="button"
            aria-expanded={accountOpen}
            aria-haspopup="menu"
            onClick={() => {
              setLogoutError('')
              setAccountOpen((open) => !open)
            }}
            onKeyDown={handleTriggerKeyDown}
          >
            <NavIcon name="account" />
            账号
            <svg className="nav-chevron" viewBox="0 0 16 16" aria-hidden="true">
              <path d="m4.5 6 3.5 3.5L11.5 6" />
            </svg>
          </button>
          {accountOpen && (
            <div className="account-popover" role="menu" aria-label="账号操作" onKeyDown={handleMenuKeyDown}>
              {loading ? (
                <p>加载中…</p>
              ) : user ? (
                <>
                  <p className="account-user">{user.username}</p>
                  <button
                    type="button"
                    role="menuitem"
                    className="account-logout"
                    disabled={loggingOut}
                    onClick={() => void handleLogout()}
                  >
                    {loggingOut ? '正在退出…' : '退出登录'}
                  </button>
                  {logoutError && <p className="account-menu-error" role="alert">{logoutError}</p>}
                </>
              ) : (
                <>
                  <p>未登录</p>
                  <button type="button" role="menuitem" onClick={() => openAuth('login')}>登录</button>
                  <button type="button" role="menuitem" onClick={() => openAuth('register')}>注册</button>
                </>
              )}
            </div>
          )}
        </div>
      </nav>
      {authMode && (
        <AuthDialog
          mode={authMode}
          onModeChange={setAuthMode}
          onClose={() => setAuthMode(null)}
          login={login}
          register={register}
          returnFocus={accountTriggerRef.current}
        />
      )}
      {feedbackOpen && (
        <FeedbackDialog onClose={() => setFeedbackOpen(false)} returnFocus={feedbackTriggerRef.current} />
      )}
    </header>
  )
}
