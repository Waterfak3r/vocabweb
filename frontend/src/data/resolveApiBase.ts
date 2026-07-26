/**
 * Resolves a configured API base into an absolute URL that ends with a slash.
 *
 * The configured base may be absolute (e.g. `http://127.0.0.1:3000`) or relative
 * to the page origin (e.g. `/`, used by production builds that the backend serves
 * from its own origin). Absolute bases ignore the origin and behave exactly as a
 * bare `new URL(base)` did before; relative bases resolve against
 * `window.location.origin`, falling back to `http://localhost` when there is no
 * DOM (e.g. the Node vitest environment).
 *
 * The result always ends with a trailing slash so that later
 * `new URL(relativePath, base)` joins append instead of replacing the last path
 * segment. Empty/unset bases are rejected — that case means "no backend,
 * local-only mode" and is gated upstream before any repository is constructed.
 */
export function resolveApiBase(baseUrl: string): URL {
  const trimmed = baseUrl.trim()
  if (!trimmed) throw new TypeError('Backend API base URL must not be empty.')

  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'http://localhost'
  const url = new URL(trimmed, origin)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError('Backend API base URL must use HTTP or HTTPS.')
  }

  url.search = ''
  url.hash = ''
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url
}
