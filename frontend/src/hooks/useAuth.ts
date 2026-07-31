import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { getWorkspaceApi, type AuthUser } from '../data/workspaceApi'
import { rotateStudyClientId, setStudyClientId } from '../data/studyApi'

export type UseAuth = {
  user: AuthUser | null
  loading: boolean
  login: (username: string, password: string) => Promise<AuthUser>
  register: (username: string, password: string) => Promise<AuthUser>
  logout: () => Promise<void>
}

const AuthContext = createContext<UseAuth | null>(null)

/** Server confirmation must happen before local identity is separated/reloaded. */
export async function completeLogout(
  endServerSession: () => Promise<void>,
  rotateAnonymousId: () => unknown = rotateStudyClientId,
  reload: () => void = () => window.location.reload(),
) {
  await endServerSession()
  rotateAnonymousId()
  reload()
}

/**
 * Session-cookie account state for the header 账号 menu.
 *
 * On mount it asks the backend who is signed in. The auth routes land in a later
 * wave, so EVERY failure — a 404 from an older server, a network error, a
 * timeout — is treated as "logged out"; only a real {@link AuthUser} counts as
 * logged in. After a successful register/login the server returns the account's
 * data clientId, which we persist over the local anonymous id and then reload so
 * every consumer re-reads clean state under the account's data home.
 */
function useAuthState(): UseAuth {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const api = getWorkspaceApi()
    if (!api) {
      // Local-only mode (no backend configured): there is nobody to sign in as.
      setLoading(false)
      return
    }
    let active = true
    api
      .me()
      .then((found) => {
        if (active) setUser(found)
      })
      .catch(() => {
        // Older backend without /api/auth, or an offline device: stay anonymous.
        if (active) setUser(null)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  // clientId is retained for compatibility with the current data-partition API;
  // the server session, not this browser-readable value, is the auth credential.
  const adopt = useCallback((account: AuthUser) => {
    setStudyClientId(account.clientId)
    window.location.reload()
  }, [])

  const login = useCallback(
    async (username: string, password: string) => {
      const api = getWorkspaceApi()
      if (!api) throw new Error('后端未配置。')
      const account = await api.login(username, password)
      adopt(account)
      return account
    },
    [adopt],
  )

  const register = useCallback(
    async (username: string, password: string) => {
      const api = getWorkspaceApi()
      if (!api) throw new Error('后端未配置。')
      const account = await api.register(username, password)
      adopt(account)
      return account
    },
    [adopt],
  )

  const logout = useCallback(async () => {
    const api = getWorkspaceApi()
    if (!api) throw new Error('后端未配置。')

    // Never pretend a logout succeeded: only separate the local anonymous data
    // home after the server has confirmed that the session is gone.
    await completeLogout(() => api.logout())
  }, [])

  return useMemo(
    () => ({ user, loading, login, register, logout }),
    [user, loading, login, register, logout],
  )
}

/** One session lookup shared by the header and every routed account surface. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const auth = useAuthState()
  return createElement(AuthContext.Provider, { value: auth }, children)
}

export function useAuth(): UseAuth {
  const auth = useContext(AuthContext)
  if (!auth) throw new Error('useAuth must be used within AuthProvider')
  return auth
}
