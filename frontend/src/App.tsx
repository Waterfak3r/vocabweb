import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import { HomePage } from './pages/HomePage'
import { MarketplacePage } from './pages/MarketplacePage'
import { WordbookPage } from './pages/WordbookPage'

function App() {
  return (
    <Routes>
        <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="marketplace" element={<MarketplacePage />} />
        <Route path="wordbook" element={<WordbookPage />} />
        <Route path="flashcards" element={<Navigate to="/wordbook?mode=flashcards" replace />} />
        <Route path="dictation" element={<Navigate to="/wordbook?mode=dictation" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export default App
