import { describe, expect, it } from 'vitest'
import { mapAuthError } from './AuthDialog'
import { WorkspaceApiError } from '../../data/workspaceApi'

describe('mapAuthError', () => {
  it('maps credential and username conflicts to actionable messages', () => {
    expect(mapAuthError(new Error('Backend request failed (401).'))).toBe('用户名或密码不正确')
    expect(mapAuthError(new WorkspaceApiError(409, 'USERNAME_TAKEN'))).toBe('用户名已被占用')
    expect(mapAuthError(new WorkspaceApiError(409, 'ACTIVE_SESSION_ACCOUNT_CONFLICT'))).toBe('请先退出当前账号，再登录其他账号')
    expect(mapAuthError(new WorkspaceApiError(429, 'LOGIN_RATE_LIMITED'))).toBe('尝试次数过多，请稍后再试')
  })

  it('does not expose unexpected transport details', () => {
    expect(mapAuthError(new Error('socket 10.0.0.1 refused'))).toBe('网络错误，请稍后重试')
  })
})
