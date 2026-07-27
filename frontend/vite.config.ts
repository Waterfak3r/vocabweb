import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // Dev must be same-origin so SameSite=Lax session cookies flow between the
    // page and the API: Vite proxies /api to the backend instead of the browser
    // hitting the backend origin directly. Production is already same-origin.
    proxy: {
      '/api': 'http://127.0.0.1:3000',
    },
  },
})
