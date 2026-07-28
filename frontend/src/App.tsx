import { Component, lazy, type ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'

// Route-level code splitting keeps the entry chunk to the shell + the page
// actually visited instead of shipping all three pages up front.
const HomePage = lazy(() => import('./pages/HomePage').then((m) => ({ default: m.HomePage })))
const MarketplacePage = lazy(() => import('./pages/MarketplacePage').then((m) => ({ default: m.MarketplacePage })))
const MarketplaceDetailPage = lazy(() => import('./pages/MarketplaceDetailPage').then((m) => ({ default: m.MarketplaceDetailPage })))
const WordbookPage = lazy(() => import('./pages/WordbookPage').then((m) => ({ default: m.WordbookPage })))
const MessagesPage = lazy(() => import('./pages/MessagesPage').then((m) => ({ default: m.MessagesPage })))
const SourcesPage = lazy(() => import('./pages/SourcesPage').then((m) => ({ default: m.SourcesPage })))

type ChunkErrorBoundaryState = { failed: boolean }

/** A failed lazy-chunk load (redeploy, flaky network) must not blank the app. */
class ChunkErrorBoundary extends Component<{ children: ReactNode }, ChunkErrorBoundaryState> {
  state: ChunkErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): ChunkErrorBoundaryState {
    return { failed: true }
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="page-loading" role="alert">
          <p>页面加载失败，请重试。</p>
          <button type="button" onClick={() => window.location.reload()}>
            重新加载
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

function App() {
  return (
    <ChunkErrorBoundary>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route path="marketplace" element={<MarketplacePage />} />
          <Route path="marketplace/:id" element={<MarketplaceDetailPage />} />
          <Route path="wordbook" element={<WordbookPage />} />
          <Route path="messages" element={<MessagesPage />} />
          <Route path="sources" element={<SourcesPage />} />
          <Route path="flashcards" element={<Navigate to="/wordbook?mode=flashcards" replace />} />
          <Route path="dictation" element={<Navigate to="/wordbook?mode=dictation" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </ChunkErrorBoundary>
  )
}

export default App
