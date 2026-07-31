import { WorkspaceApiError } from '../../data/workspaceApi'

export const ACCOUNT_PASSWORD_MIN = 8
export const ACCOUNT_PASSWORD_MAX = 72

export type PasswordChangeFields = {
  currentPassword: string
  newPassword: string
  confirmPassword: string
}

export type PasswordChangeErrors = Partial<Record<keyof PasswordChangeFields, string>>

function passwordLengthValid(value: string) {
  return value.length >= ACCOUNT_PASSWORD_MIN && value.length <= ACCOUNT_PASSWORD_MAX
}

export function validatePasswordChange(fields: PasswordChangeFields): PasswordChangeErrors {
  const errors: PasswordChangeErrors = {}
  if (!passwordLengthValid(fields.currentPassword)) {
    errors.currentPassword = '请输入有效的当前密码。'
  }
  if (!passwordLengthValid(fields.newPassword)) {
    errors.newPassword = '新密码需为 8-72 位。'
  } else if (fields.newPassword.normalize('NFC') === fields.currentPassword.normalize('NFC')) {
    errors.newPassword = '新密码不能与当前密码相同。'
  }
  if (fields.confirmPassword !== fields.newPassword) {
    errors.confirmPassword = '两次输入的新密码不一致。'
  }
  return errors
}

export function canDeleteAccount(username: string, confirmation: string, password: string) {
  return confirmation === username && passwordLengthValid(password)
}

export function mapPasswordChangeError(error: unknown): string {
  if (error instanceof WorkspaceApiError) {
    if (error.code === 'INVALID_PASSWORD') return '当前密码不正确。'
    if (error.code === 'PASSWORD_UNCHANGED') return '新密码不能与当前密码相同。'
    if (error.code === 'INVALID_PASSWORD_CHANGE' || error.status === 400) return '请检查密码格式后重试。'
    if (error.status === 401) return '登录已失效，请重新登录。'
    if (error.status === 429) return '尝试次数过多，请稍后再试。'
  }
  return '密码修改失败，请检查网络后重试。'
}

export function mapAccountDeletionError(error: unknown): string {
  if (error instanceof WorkspaceApiError) {
    if (error.code === 'INVALID_PASSWORD' || error.status === 403) return '当前密码不正确。'
    if (error.status === 401) return '登录已失效，请重新登录。'
    if (error.status === 429) return '尝试次数过多，请稍后再试。'
  }
  return '账号注销失败，请检查网络后重试。'
}
