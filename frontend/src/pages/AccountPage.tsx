import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { AccountActivityHeatmap } from '../components/account/AccountActivityHeatmap'
import { AccountDeletionDialog } from '../components/account/AccountDeletionDialog'
import { AccountRecentActivity } from '../components/account/AccountRecentActivity'
import { AuthDialog, type AuthMode } from '../components/account/AuthDialog'
import {
  mapPasswordChangeError,
  validatePasswordChange,
  type PasswordChangeFields,
} from '../components/account/accountForms'
import { UserAvatar } from '../components/account/UserAvatar'
import { PageHeader } from '../components/layout/PageHeader'
import { Button } from '../components/ui/Button'
import { TextField } from '../components/ui/TextField'
import { getWorkspaceApi, type AccountStudyProfile } from '../data/workspaceApi'
import { useAuth } from '../hooks/useAuth'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

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

function metricNumber(value: number) {
  return new Intl.NumberFormat('zh-CN').format(Math.max(0, Number.isFinite(value) ? value : 0))
}

export function AccountPage() {
  useDocumentTitle('个人资料')
  const { user, loading, login, register } = useAuth()
  const [authMode, setAuthMode] = useState<AuthMode | null>(null)
  const [profile, setProfile] = useState<AccountStudyProfile | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [profileError, setProfileError] = useState('')
  const [profileVersion, setProfileVersion] = useState(0)
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
      setProfile(null)
      setProfileLoading(false)
      setProfileError('')
      return
    }

    let active = true
    setProfile(null)
    setProfileLoading(true)
    setProfileError('')
    api.getAccountProfile()
      .then((nextProfile) => {
        if (active) setProfile(nextProfile)
      })
      .catch(() => {
        if (active) setProfileError('学习数据暂时无法加载。')
      })
      .finally(() => {
        if (active) setProfileLoading(false)
      })
    return () => {
      active = false
    }
  }, [api, profileVersion, user])

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

  const title = user ? '个人资料' : '账户资料'

  return (
    <section className="account-page">
      <PageHeader
        title={title}
        description={!user && !loading ? '登录后管理账号、学习数据和安全设置。' : undefined}
        aside={user ? <a className="account-settings-link" href="#account-settings">账户设置</a> : undefined}
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
        <div className="account-profile">
          <section className="account-profile-hero" aria-label="账号摘要">
            <UserAvatar username={user.username} size="lg" className="account-hero-avatar" />
            <div className="account-identity-copy">
              <h2>{user.username}</h2>
              <p>{user.role === 'admin' ? '管理员账号' : '学习者账号'}</p>
            </div>
          </section>

          <section className="account-stats" aria-labelledby="account-stats-title">
            <h2 id="account-stats-title" className="sr-only">学习概览</h2>
            {profileLoading ? (
              <div className="account-metrics-loading" role="status" aria-label="正在加载学习概览">
                <span /><span /><span /><span /><span />
              </div>
            ) : profileError || !profile ? (
              <div className="account-profile-error">
                <p role="alert">{profileError || '学习概览暂时无法加载。'}</p>
                <button type="button" onClick={() => setProfileVersion((value) => value + 1)}>重试</button>
              </div>
            ) : (
              <dl className="account-metrics">
                <div><dt>词书</dt><dd aria-label={`${metricNumber(profile.metrics.wordbookCount)} 本`}>{metricNumber(profile.metrics.wordbookCount)}</dd></div>
                <div><dt>收录词</dt><dd aria-label={`${metricNumber(profile.metrics.wordCount)} 个`}>{metricNumber(profile.metrics.wordCount)}</dd></div>
                <div><dt>已学习</dt><dd aria-label={`${metricNumber(profile.metrics.learnedWordCount)} 个`}>{metricNumber(profile.metrics.learnedWordCount)}</dd></div>
                <div><dt>90天连续</dt><dd data-unit="天" aria-label={`近 90 天连续学习 ${metricNumber(profile.metrics.currentStreak)} 天`}>{metricNumber(profile.metrics.currentStreak)}</dd></div>
                <div><dt>90天最长</dt><dd data-unit="天" aria-label={`${metricNumber(profile.metrics.longestStreak)} 天`}>{metricNumber(profile.metrics.longestStreak)}</dd></div>
              </dl>
            )}
          </section>

          <AccountActivityHeatmap
            profile={profile}
            loading={profileLoading}
            error={profileError}
            onRetry={() => setProfileVersion((value) => value + 1)}
            showError={false}
          />
          <AccountRecentActivity
            items={profile?.recentActivity ?? null}
            loading={profileLoading}
            error={profileError}
            onRetry={() => setProfileVersion((value) => value + 1)}
            showError={false}
          />

          <section className="account-settings" id="account-settings" aria-labelledby="account-settings-title">
            <header className="account-settings-header">
              <h2 id="account-settings-title">账户设置</h2>
              <p>管理账号信息、安全设置和数据去向。</p>
            </header>

            <div className="account-settings-ledger">
              <section className="account-settings-row" aria-labelledby="account-information-title">
                <header>
                  <h3 id="account-information-title">账户信息</h3>
                  <p>查看并管理你的账号基本信息。</p>
                </header>
                <dl className="account-details">
                  <div><dt>用户名</dt><dd>{user.username}</dd></div>
                  <div><dt>账号类型</dt><dd>{user.role === 'admin' ? '管理员' : '普通用户'}</dd></div>
                  <div><dt>加入时间</dt><dd>{accountDate(user.createdAt)}</dd></div>
                </dl>
              </section>

              <section className="account-settings-row" aria-labelledby="account-password-title">
                <header>
                  <h3 id="account-password-title">修改密码</h3>
                  <p>更新后，其他设备上的登录会立即退出。</p>
                </header>
                <form className="account-password-form" onSubmit={changePassword} noValidate>
                  <TextField
                    label="当前密码"
                    type="password"
                    value={passwords.currentPassword}
                    onChange={(value) => setPasswordField('currentPassword', value)}
                    autoComplete="current-password"
                    placeholder="请输入当前密码"
                    error={passwordAttempted ? passwordErrors.currentPassword : undefined}
                  />
                  <TextField
                    label="新密码"
                    hint="使用 8-72 位字符。"
                    type="password"
                    value={passwords.newPassword}
                    onChange={(value) => setPasswordField('newPassword', value)}
                    autoComplete="new-password"
                    placeholder="请输入新密码"
                    error={passwordAttempted ? passwordErrors.newPassword : undefined}
                  />
                  <TextField
                    label="确认新密码"
                    type="password"
                    value={passwords.confirmPassword}
                    onChange={(value) => setPasswordField('confirmPassword', value)}
                    autoComplete="new-password"
                    placeholder="请再次输入新密码"
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

              <section className="account-settings-row" aria-labelledby="account-privacy-title">
                <header>
                  <h3 id="account-privacy-title">数据与隐私</h3>
                  <p>管理你的数据与隐私相关设置。</p>
                </header>
                <div className="account-ledger-actions">
                  <div className="account-ledger-action">
                    <div>
                      <strong>导出我的数据</strong>
                      <p>下载服务器保存的词书与学习记录。</p>
                    </div>
                    <Button variant="secondary" disabled={exporting} onClick={() => void exportAccountData()}>
                      {exporting ? '正在导出…' : '导出数据'}
                    </Button>
                  </div>
                  <div className="account-ledger-action">
                    <div>
                      <strong>隐私与数据说明</strong>
                      <p>了解数据如何存储与使用。</p>
                    </div>
                    <Link className="account-ledger-link" to="/privacy">查看说明<span aria-hidden="true">→</span></Link>
                  </div>
                </div>
                <p className="account-export-status" aria-live="polite">{exportStatus}</p>
              </section>

              <section className="account-settings-row account-danger-section" aria-labelledby="account-danger-title">
                <header>
                  <h3 id="account-danger-title">危险操作</h3>
                  <p>该操作不可逆，请谨慎处理。</p>
                </header>
                <div className="account-danger-action">
                  <div>
                    <strong>注销账号</strong>
                    <p>永久删除私人学习数据、会话和发布内容。</p>
                  </div>
                  <Button variant="danger" onClick={() => setDeleteOpen(true)}>注销账号<span aria-hidden="true">→</span></Button>
                </div>
              </section>
            </div>
          </section>
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
