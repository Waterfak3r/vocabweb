import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import App from './App'

import '@fontsource-variable/source-serif-4'
import '@fontsource-variable/source-sans-3'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'

import './styles/tokens.css'
import './styles/reset.css'
import './styles/base.css'
import './styles/layout.css'
import './styles/utilities.css'
import './styles/components.css'
import './styles/word.css'
import './styles/marketplace.css'
import './styles/workspace.css'
import './styles/account.css'
import './styles/messages.css'

// A redeploy invalidates old hashed chunk names a stale tab still references;
// reloading once picks up the new manifest instead of a dead lazy route.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  window.location.reload()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
