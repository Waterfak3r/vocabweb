import { Outlet, useLocation } from 'react-router'
import { Suspense, useEffect } from 'react'
import { AuthProvider } from '../../hooks/useAuth'
import { selectPersistFailed, useWordbook } from '../../data/wordbookStore'
import { SiteFooter } from './SiteFooter'
import { SiteHeader } from './SiteHeader'

/** App frame: skip link, header, routed page, quiet footer. */
export function AppShell() {
  const { pathname } = useLocation()
  const persistFailed = useWordbook(selectPersistFailed)

  // Move keyboard focus to the page on route change.
  useEffect(() => {
    document.getElementById('main-content')?.focus({ preventScroll: true })
    window.scrollTo(0, 0)
  }, [pathname])

  return (
    <AuthProvider>
      <div className="app-shell">
        <a className="skip-link" href="#main-content">
          跳到主要内容
        </a>
        <SiteHeader />
        {persistFailed && (
          <p className="storage-warning" role="alert">
            本地存储不可用，最近的更改不会被保存。请检查浏览器隐私模式或存储空间。
          </p>
        )}
        <main
          id="main-content"
          className={`site-main${pathname === '/' ? ' site-main-home' : ''}`}
          tabIndex={-1}
        >
          {/* Inside the shell so header/nav stay visible while a lazy page chunk loads. */}
          <Suspense fallback={<p className="page-loading">加载中…</p>}>
            <Outlet />
          </Suspense>
        </main>
        <SiteFooter />
      </div>
    </AuthProvider>
  )
}
