import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
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
import { WorkspaceApiError, getWorkspaceApi, type AccountStudyProfile } from '../data/workspaceApi'
import { THEME_LABELS, isTheme, type QuickThemes, type Theme } from '../data/themePreference'
import { useAuth } from '../hooks/useAuth'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useTheme } from '../hooks/useTheme'
import { AccountAvatarImageError, prepareAccountAvatar } from '../lib/accountAvatar'

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

function avatarErrorMessage(error: unknown) {
  if (error instanceof AccountAvatarImageError) {
    if (error.code === 'unsupported') return '请选择 JPG、PNG 或 WebP 图片。'
    if (error.code === 'too-large') return '原图不能超过 10 MB。'
    if (error.code === 'decode') return '无法读取这张图片，请尝试其他文件。'
    return '图片处理失败，请尝试其他文件。'
  }
  if (error instanceof WorkspaceApiError) {
    if (error.code === 'AVATAR_TOO_LARGE') return '处理后的头像仍然过大，请尝试其他图片。'
    if (error.code === 'UNSUPPORTED_AVATAR_TYPE' || error.code === 'INVALID_AVATAR_IMAGE') return '头像格式无效，请尝试其他图片。'
  }
  return '头像保存失败，请稍后重试。'
}

const VISUAL_STYLES: ReadonlyArray<{
  value: Theme
  label: string
  description: string
}> = [
  { value: 'paper', label: '纸白', description: '暖白纸面、墨色正文与朱砂标记。' },
  { value: 'graphite', label: '石墨纸', description: '炭灰纸面、柔白字色与低调颗粒。' },
  { value: 'dusk', label: '黄昏', description: '暮紫底色、余晖珊瑚与暖金细节。' },
  { value: 'city-pop', label: 'City Pop', description: '午夜蓝、霓虹粉与海风青色标记。' },
  { value: 'classic-light', label: '原版白天', description: '改版前的暖白底、藏蓝文字与柔和光晕。' },
  { value: 'classic-dark', label: '原版黑夜', description: '改版前的深海军蓝、亮色正文与蓝色光晕。' },
]

function AccountStylePicker({
  theme,
  quickThemes,
  onChange,
  onQuickThemesChange,
}: {
  theme: Theme
  quickThemes: QuickThemes
  onChange: (theme: Theme) => void
  onQuickThemesChange: (themes: QuickThemes) => void
}) {
  function updateQuickTheme(position: 0 | 1, value: string) {
    if (!isTheme(value)) return
    const otherPosition = position === 0 ? 1 : 0
    if (value === quickThemes[otherPosition]) return
    onQuickThemesChange(position === 0 ? [value, quickThemes[1]] : [quickThemes[0], value])
  }

  return (
    <section className="account-appearance" aria-labelledby="account-appearance-title">
      <header className="account-appearance-copy">
        <p className="marginal">APPEARANCE</p>
        <h2 id="account-appearance-title">界面风格</h2>
        <p>六种完整风格，选择后会立即应用到当前浏览器。</p>
      </header>
      <fieldset className="account-style-fieldset">
        <legend className="sr-only">选择界面风格</legend>
        <div className="account-style-options">
          {VISUAL_STYLES.map((option) => {
            const selected = theme === option.value
            return (
              <label key={option.value} className={`account-style-option${selected ? ' is-selected' : ''}`}>
                <input
                  className="sr-only"
                  type="radio"
                  name="account-visual-style"
                  value={option.value}
                  checked={selected}
                  onChange={() => onChange(option.value)}
                />
                <span className={`account-style-sample is-${option.value}`} aria-hidden="true">
                  <span /><span /><span />
                </span>
                <span className="account-style-option-copy">
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </span>
                <span className="account-style-option-status">{selected ? '使用中' : '选择'}</span>
              </label>
            )
          })}
        </div>
        <div className="account-quick-switch" aria-labelledby="account-quick-switch-title">
          <div className="account-quick-switch-copy">
            <p className="marginal">QUICK SWITCH</p>
            <h3 id="account-quick-switch-title">导航栏快切</h3>
            <p>指定两种常用风格，页头“风格”按钮只在它们之间切换。</p>
          </div>
          <div className="account-quick-switch-controls">
            <label>
              风格一
              <select
                aria-label="快切风格一"
                value={quickThemes[0]}
                onChange={(event) => updateQuickTheme(0, event.currentTarget.value)}
              >
                {VISUAL_STYLES.map((option) => (
                  <option key={option.value} value={option.value} disabled={option.value === quickThemes[1]}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <span aria-hidden="true">⇄</span>
            <label>
              风格二
              <select
                aria-label="快切风格二"
                value={quickThemes[1]}
                onChange={(event) => updateQuickTheme(1, event.currentTarget.value)}
              >
                {VISUAL_STYLES.map((option) => (
                  <option key={option.value} value={option.value} disabled={option.value === quickThemes[0]}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <p aria-live="polite">
              当前快切：{THEME_LABELS[quickThemes[0]]} / {THEME_LABELS[quickThemes[1]]}
            </p>
          </div>
        </div>
        <p className="account-style-storage-note">风格偏好仅保存在这台设备，不跟随账号同步。</p>
      </fieldset>
    </section>
  )
}

export function AccountPage() {
  useDocumentTitle('个人资料')
  const { user, loading, login, register, replaceUser } = useAuth()
  const { theme, selectTheme, quickThemes, selectQuickThemes } = useTheme()
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
  const [avatarAction, setAvatarAction] = useState<'upload' | 'remove' | null>(null)
  const [avatarStatus, setAvatarStatus] = useState('')
  const [avatarError, setAvatarError] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)
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
  }, [api, profileVersion, user?.clientId])

  async function uploadAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file || !api || avatarAction) return
    setAvatarAction('upload')
    setAvatarStatus('')
    setAvatarError(false)
    try {
      const image = await prepareAccountAvatar(file)
      const updated = await api.uploadAccountAvatar(image)
      replaceUser(updated)
      setAvatarStatus('头像已更新。')
    } catch (error) {
      setAvatarError(true)
      setAvatarStatus(avatarErrorMessage(error))
    } finally {
      setAvatarAction(null)
    }
  }

  async function removeAvatar() {
    if (!api || avatarAction) return
    setAvatarAction('remove')
    setAvatarStatus('')
    setAvatarError(false)
    try {
      const updated = await api.deleteAccountAvatar()
      replaceUser(updated)
      setAvatarStatus('已恢复为默认字母头像。')
    } catch (error) {
      setAvatarError(true)
      setAvatarStatus(avatarErrorMessage(error))
    } finally {
      setAvatarAction(null)
    }
  }

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

      <AccountStylePicker
        theme={theme}
        quickThemes={quickThemes}
        onChange={selectTheme}
        onQuickThemesChange={selectQuickThemes}
      />

      {loading ? (
        <div className="account-loading" role="status" aria-label="正在加载账户资料">
          <span />
          <div><span /><span /><span /></div>
        </div>
      ) : !user ? (
        <div className="account-gate">
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
            <div className="account-avatar-editor">
              <UserAvatar username={user.username} avatarUrl={user.avatarUrl} size="lg" className="account-hero-avatar" />
              {user.avatarUrl !== undefined && (
                <>
                  <input
                    ref={avatarInputRef}
                    className="sr-only"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    aria-label="选择头像图片"
                    onChange={(event) => { void uploadAvatar(event) }}
                  />
                  <div className="account-avatar-actions">
                    <button type="button" disabled={avatarAction !== null} onClick={() => avatarInputRef.current?.click()}>
                      {avatarAction === 'upload' ? '处理中…' : user.avatarUrl ? '更换头像' : '上传头像'}
                    </button>
                    {user.avatarUrl && (
                      <button className="account-avatar-remove" type="button" disabled={avatarAction !== null} onClick={() => { void removeAvatar() }}>
                        {avatarAction === 'remove' ? '正在移除…' : '移除'}
                      </button>
                    )}
                  </div>
                  <p className={avatarError ? 'account-avatar-status error' : 'account-avatar-status'} aria-live="polite">
                    {avatarStatus || 'JPG、PNG 或 WebP，自动裁切为正方形。'}
                  </p>
                </>
              )}
            </div>
            <div className="account-identity-copy">
              <h2>{user.username}</h2>
              <p>{user.role === 'admin' ? '管理员账号' : '学习者账号'}</p>
            </div>
          </section>

          <section className="account-stats" aria-labelledby="account-stats-title">
            <h2 id="account-stats-title" className="sr-only">学习概览</h2>
            {profileLoading ? (
              <div className="account-metrics-loading" role="status" aria-label="正在加载学习概览">
                <span /><span /><span />
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
              </dl>
            )}
          </section>

          {(profileLoading || profile) && (
            <>
              <AccountActivityHeatmap
                profile={profile}
                loading={profileLoading}
                error={profileError}
                onRetry={() => setProfileVersion((value) => value + 1)}
              />
              <AccountRecentActivity
                items={profile?.recentActivity ?? null}
                loading={profileLoading}
                error={profileError}
                onRetry={() => setProfileVersion((value) => value + 1)}
                showError={false}
              />
            </>
          )}

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
