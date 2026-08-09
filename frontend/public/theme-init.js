// Restore the saved visual style before React paints.
try {
  const rawTheme = localStorage.getItem('vocab-ielts:theme:v1')
  let savedTheme = rawTheme
  try { savedTheme = JSON.parse(rawTheme) } catch { /* legacy bare strings stay readable */ }
  const themeColors = {
    paper: '#f1eee7',
    graphite: '#191916',
    dusk: '#211821',
    'city-pop': '#101b35',
    'classic-light': '#fdf9f4',
    'classic-dark': '#0c1622',
  }
  const legacyTheme = savedTheme === 'light'
    ? 'classic-light'
    : savedTheme === 'dark' ? 'classic-dark' : savedTheme
  const theme = Object.hasOwn(themeColors, legacyTheme) ? legacyTheme : 'paper'
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColors[theme])
} catch {
  // Storage can be unavailable in privacy mode; paper remains the valid default.
}
