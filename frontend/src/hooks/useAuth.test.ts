import { describe, expect, it, vi } from 'vitest'
import { completeLogout } from './useAuth'

describe('completeLogout', () => {
  it('rotates the anonymous data id only after the server ends the session', async () => {
    const order: string[] = []
    const endServerSession = vi.fn(async () => { order.push('server') })
    const clearCache = vi.fn(() => { order.push('clear') })
    const rotate = vi.fn(() => { order.push('rotate') })
    const reload = vi.fn(() => { order.push('reload') })

    await completeLogout(endServerSession, rotate, reload, clearCache)

    expect(order).toEqual(['server', 'clear', 'rotate', 'reload'])
  })

  it('keeps the current identity and page when the server logout fails', async () => {
    const failure = new Error('offline')
    const rotate = vi.fn()
    const reload = vi.fn()

    await expect(completeLogout(async () => { throw failure }, rotate, reload)).rejects.toBe(failure)
    expect(rotate).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })
})
