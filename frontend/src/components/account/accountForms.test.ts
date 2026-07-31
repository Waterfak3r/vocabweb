import { describe, expect, it } from 'vitest'
import { WorkspaceApiError } from '../../data/workspaceApi'
import {
  canDeleteAccount,
  mapAccountDeletionError,
  mapPasswordChangeError,
  validatePasswordChange,
} from './accountForms'

describe('account form contracts', () => {
  it('validates a complete password change without trimming secrets', () => {
    expect(validatePasswordChange({
      currentPassword: 'current-password',
      newPassword: 'new-password-456',
      confirmPassword: 'new-password-456',
    })).toEqual({})

    expect(validatePasswordChange({
      currentPassword: 'password-123',
      newPassword: 'password-123',
      confirmPassword: 'different',
    })).toEqual({
      newPassword: '新密码不能与当前密码相同。',
      confirmPassword: '两次输入的新密码不一致。',
    })
  })

  it('requires the exact username and a valid password before account deletion', () => {
    expect(canDeleteAccount('墨客', '墨客', 'password-123')).toBe(true)
    expect(canDeleteAccount('墨客', '墨客 ', 'password-123')).toBe(false)
    expect(canDeleteAccount('墨客', '墨客', 'short')).toBe(false)
  })

  it('maps stable account errors without exposing transport details', () => {
    expect(mapPasswordChangeError(new WorkspaceApiError(403, 'INVALID_PASSWORD'))).toBe('当前密码不正确。')
    expect(mapPasswordChangeError(new WorkspaceApiError(429, 'LOGIN_RATE_LIMITED'))).toBe('尝试次数过多，请稍后再试。')
    expect(mapAccountDeletionError(new WorkspaceApiError(401, 'AUTH_REQUIRED'))).toBe('登录已失效，请重新登录。')
    expect(mapAccountDeletionError(new Error('socket 10.0.0.1 refused'))).toBe('账号注销失败，请检查网络后重试。')
  })
})
