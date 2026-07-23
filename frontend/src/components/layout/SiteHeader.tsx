import { NavLink } from 'react-router-dom'

const NAVIGATION = [
  { to: '/', label: '查词', end: true },
  { to: '/wordbook', label: '单词本' },
  { to: '/flashcards', label: '单词卡' },
  { to: '/dictation', label: '听写' },
]

export function SiteHeader() {
  return (
    <header className="site-header">
      <NavLink className="brand" to="/" aria-label="墨水词典 Vocab IELTS 首页">
        <span className="brand-mark" aria-hidden="true">
          墨
        </span>
        <span className="brand-name">Vocab IELTS</span>
      </NavLink>

      <nav className="main-nav" aria-label="主导航">
        {NAVIGATION.map(({ to, label, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              isActive ? 'nav-link active' : 'nav-link'
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>
    </header>
  )
}
