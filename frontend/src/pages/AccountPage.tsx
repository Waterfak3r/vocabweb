import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { AccountDeletionDialog } from '../components/account/AccountDeletionDialog'
import { AuthDialog, type AuthMode } from '../components/account/AuthDialog'
import {
  mapPasswordChangeError,
  validatePasswordChange,
  type PasswordChangeFields,
} from '../components/account/accountForms'
import { PageHeader } from '../components/layout/PageHeader'
import { Button } from '../components/ui/Button'
import { TextField } from '../components/ui/TextField'
import { getWorkspaceApi } from '../data/workspaceApi'
import { useAuth } from '../hooks/useAuth'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

type AccountOverview = {
  wordbooks: number
  words: number
  uploads: number
}

const EMPTY_PASSWORDS: PasswordChangeFields = {
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
}

function accountDate(value: string | undefined) {
  if (!value) return '暂不可用'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '暂不可用'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date)
}

export function AccountPage() {
  useDocumentTitle('账户资料')
  const { user, loading, login, register } = useAuth()
  const [authMode, setAuthMode] = useState<AuthMode | null>(null)
  const [overview, setOverview] = useState<AccountOverview | null>(null)
  const [overviewError, setOverviewError] = useState('')
  const [overviewVersion, setOverviewVersion] = useState(0)
  const [passwords, setPasswords] = useState<PasswordChangeFields>(EMPTY_PASSWORDS)
  const [passwordAttempted, setPasswordAttempted] = useState(false)
  const [passwordSubmitting, setPasswordSubmitting] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [passwordSuccess, setPasswordSuccess] = useState('')
  const [exporting, setExporting] = useState(false)
  const [exportStatus, setExportStatus] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const api = getWorkspaceApi()
  const passwordErrors = useMemo(() => validatePasswordChange(passwords), [passwords])
  const passwordReady = Object.keys(passwordErrors).length === 0

  useEffect(() => {
    if (!user || !api) {
      setOverview(null)
      return
    }
    let active = true
    setOverview(null)
    setOverviewError('')
    Promise.all([api.listMyWordbooks(), api.listUploads()])
      .then(([wordbooks, uploads]) => {
        if (!active) return
        setOverview({
          wordbooks: wordbooks.length,
          words: wordbooks.reduce((total, wordbook) => total + wordbook.wordCount, 0),
          uploads: uploads.length,
        })
      })
      .catch(() => {
        if (active) setOverviewError('学习概览暂时无法加载。')
      })
    return () => {
      active = false
    }
  }, [api, overviewVersion, user])

  function setPasswordField(field: keyof PasswordChangeFields, value: string) {
    setPasswords((current) => ({ ...current, [field]: value }))
    setPasswordError('')
    setPasswordSuccess('')
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault()
    setPasswordAttempted(true)
    if (!passwordReady || passwordSubmitting || !api) return
    setPasswordSubmitting(true)
    setPasswordError('')
    setPasswordSuccess('')
    try {
      await api.changePassword(passwords.currentPassword, passwords.newPassword)
      setPasswords(EMPTY_PASSWORDS)
      setPasswordAttempted(false)
      setPasswordSuccess('密码已更新，其他设备上的登录已退出。')
    } catch (caught) {
      setPasswordError(mapPasswordChangeError(caught))
    } finally {
      setPasswordSubmitting(false)
    }
  }

  async function exportAccountData() {
    if (!api || exporting) return
    setExporting(true)
    setExportStatus('')
    try {
      const payload = await api.exportAccount()
      const url = URL.createObjectURL(new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: 'application/json' }))
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = `vacabweb-export-${new Date().toISOString().slice(0, 10)}.json`
        document.body.append(link)
        link.click()
        link.remove()
      } finally {
        URL.revokeObjectURL(url)
      }
      setExportStatus('数据导出文件已生成。')
    } catch {
      setExportStatus('数据导出失败，请稍后重试。')
    } finally {
      setExporting(false)
    }
  }

  const initial = user ? Array.from(user.username)[0]?.toLocaleUpperCase('zh-CN') ?? '账' : '账'

  return (
    <section className="account-page">
      <PageHeader
        eyebrow="ACCOUNT"
        title="账户资料"
        description="查看账号身份、学习数据和安全设置。"
      />

      {loading ? (
        <div className="account-loading" role="status" aria-label="正在加载账户资料">
          <span />
          <div><span /><span /><span /></div>
        </div>
      ) : !user ? (
        <div className="account-gate">
          <p className="account-gate-mark" aria-hidden="true">W</p>
          <div>
            <h2>{api ? '登录后管理账号' : '当前未启用账号服务'}</h2>
            <p>{api ? '登录后可查看学习概览、修改密码、导出数据或注销账号。' : '此部署仅提供本地学习功能。'}</p>
          </div>
          {api && (
            <div className="account-gate-actions">
              <Button onClick={() => setAuthMode('login')}>登录</Button>
              <Button variant="secondary" onClick={() => setAuthMode('register')}>注册</Button>
            </div>
          )}
        </div>
      ) : (
        <div className="account-layout">
          <aside className="account-identity" aria-label="账号摘要">
            <div className="account-monogram" aria-hidden="true">{initial}</div>
            <div className="account-identity-copy">
              <h2>{user.username}</h2>
              <p>{user.role === 'admin' ? '管理员账号' : '学习者账号'}</p>
            </div>
            <dl className="account-meta">
              <div>
                <dt>注册日期</dt>
                <dd>{accountDate(user.createdAt)}</dd>
              </div>
              <div>
                <dt>同步状态</dt>
                <dd>服务器同步</dd>
              </div>
            </dl>
            <div className="account-overview">
              <h3>学习概览</h3>
              {overview ? (
                <dl className="account-metrics">
                  <div><dt>词书</dt><dd>{overview.wordbooks}</dd></div>
                  <div><dt>收录词</dt><dd>{overview.words}</dd></div>
                  <div><dt>我的上传</dt><dd>{overview.uploads}</dd></div>
                </dl>
              ) : overviewError ? (
                <div className="account-overview-error">
                  <p role="alert">{overviewError}</p>
                  <button type="button" onClick={() => setOverviewVersion((value) => value + 1)}>重试</button>
                </div>
              ) : (
                <div className="account-metrics-loading" aria-label="正在加载学习概览">
                  <span /><span /><span />
                </div>
              )}
            </div>
          </aside>

          <div className="account-sections">
            <section>
              <header>
                <h2>账户信息</h2>
                <p>用户名是当前账号的登录标识，暂不支持修改。</p>
              </header>
              <dl className="account-details">
                <div><dt>用户名</dt><dd>{user.username}</dd></div>
                <div><dt>账号类型</dt><dd>{user.role === 'admin' ? '管理员' : '普通用户'}</dd></div>
                <div><dt>加入时间</dt><dd>{accountDate(user.createdAt)}</dd></div>
              </dl>
            </section>

            <section>
              <header>
                <h2>修改密码</h2>
                <p>更新后，其他设备上的登录会立即退出。</p>
              </header>
              <form className="account-password-form" onSubmit={changePassword} noValidate>
                <TextField
                  label="当前密码"
                  type="password"
                  value={passwords.currentPassword}
                  onChange={(value) => setPasswordField('currentPassword', value)}
                  autoComplete="current-password"
                  error={passwordAttempted ? passwordErrors.currentPassword : undefined}
                />
                <TextField
                  label="新密码"
                  hint="使用 8-72 位字符。"
                  type="password"
                  value={passwords.newPassword}
                  onChange={(value) => setPasswordField('newPassword', value)}
                  autoComplete="new-password"
                  error={passwordAttempted ? passwordErrors.newPassword : undefined}
                />
                <TextField
                  label="确认新密码"
                  type="password"
                  value={passwords.confirmPassword}
                  onChange={(value) => setPasswordField('confirmPassword', value)}
                  autoComplete="new-password"
                  error={passwordAttempted ? passwordErrors.confirmPassword : undefined}
                />
                <div className="account-form-footer">
                  <Button type="submit" disabled={passwordSubmitting}>
                    {passwordSubmitting ? '正在保存…' : '更新密码'}
                  </Button>
                  <p className={passwordError ? 'account-form-error' : 'account-form-success'} aria-live="polite">
                    {passwordError || passwordSuccess}
                  </p>
                </div>
              </form>
            </section>

            <section>
              <header>
                <h2>数据与隐私</h2>
                <p>下载服务器保存的账号、词书、学习记录、发布内容和留言。</p>
              </header>
              <div className="account-action-row">
                <div>
                  <strong>导出我的数据</strong>
                  <p>导出为便于阅读和存档的 JSON 文件。</p>
                </div>
                <Button variant="secondary" disabled={exporting} onClick={() => void exportAccountData()}>
                  {exporting ? '正在导出…' : '导出数据'}
                </Button>
              </div>
              <p className="account-export-status" aria-live="polite">{exportStatus}</p>
              <Link className="account-privacy-link" to="/privacy">查看隐私与数据说明</Link>
            </section>

            <section className="account-danger-section">
              <header>
                <h2>注销账号</h2>
                <p>永久删除私人学习数据、会话和发布内容。</p>
              </header>
              <Button variant="danger" onClick={() => setDeleteOpen(true)}>注销账号</Button>
            </section>
          </div>
        </div>
      )}

      {authMode && (
        <AuthDialog
          mode={authMode}
          onModeChange={setAuthMode}
          onClose={() => setAuthMode(null)}
          login={login}
          register={register}
        />
      )}
      {user && deleteOpen && (
        <AccountDeletionDialog username={user.username} onClose={() => setDeleteOpen(false)} />
      )}
    </section>
  )
}
