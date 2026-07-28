// Restore the saved theme before React paints to avoid a light-mode flash.
try {
  const rawTheme = localStorage.getItem('vocab-ielts:theme:v1')
  if (rawTheme === 'dark' || JSON.parse(rawTheme) === 'dark') {
    document.documentElement.dataset.theme = 'dark'
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#0c1622')
  }
} catch {
  // Storage can be unavailable in privacy mode; the default theme remains valid.
}
