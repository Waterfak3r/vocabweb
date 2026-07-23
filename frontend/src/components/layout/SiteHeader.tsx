import { useState, type ReactNode } from 'react'
import { NavLink } from 'react-router-dom'

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
  }

  return (
    <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  )
}

export function SiteHeader() {
  const [accountOpen, setAccountOpen] = useState(false)

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
        <div className="account-menu">
          <button
            className="nav-link account-trigger"
            type="button"
            aria-expanded={accountOpen}
            aria-haspopup="menu"
            onClick={() => setAccountOpen((open) => !open)}
          >
            <NavIcon name="account" />
            账号
            <svg className="nav-chevron" viewBox="0 0 16 16" aria-hidden="true">
              <path d="m4.5 6 3.5 3.5L11.5 6" />
            </svg>
          </button>
          {accountOpen && (
            <div className="account-popover" role="menu">
              <p>学习者</p>
              <button type="button" role="menuitem" onClick={() => setAccountOpen(false)}>账号设置</button>
              <button type="button" role="menuitem" onClick={() => setAccountOpen(false)}>本地数据已保存</button>
            </div>
          )}
        </div>
      </nav>
    </header>
  )
}
