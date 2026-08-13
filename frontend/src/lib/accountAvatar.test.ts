import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ACCOUNT_AVATAR_SOURCE_MAX_BYTES,
  ACCOUNT_AVATAR_UPLOAD_MAX_BYTES,
  AccountAvatarImageError,
  prepareAccountAvatar,
} from './accountAvatar'

afterEach(() => {
  vi.unstubAllGlobals()
})

function imageFile(type = 'image/png', size = 16) {
  return new File([new Uint8Array(size)], 'avatar.png', { type })
}

function stubCanvas(blobFactory: () => Blob | null = () => new Blob([new Uint8Array(32)], { type: 'image/webp' })) {
  const drawImage = vi.fn()
  const clearRect = vi.fn()
  const context = { drawImage, clearRect }
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => context),
    toBlob: vi.fn((callback: BlobCallback) => callback(blobFactory())),
  }
  vi.stubGlobal('document', { createElement: vi.fn(() => canvas) })
  return { canvas, drawImage, clearRect }
}

describe('prepareAccountAvatar', () => {
  it('rejects unsupported and oversized source files before decoding', async () => {
    await expect(prepareAccountAvatar(imageFile('image/gif'))).rejects.toMatchObject({ code: 'unsupported' } satisfies Partial<AccountAvatarImageError>)
    expect(ACCOUNT_AVATAR_SOURCE_MAX_BYTES).toBe(2_621_440)
    await expect(prepareAccountAvatar(imageFile('image/png', ACCOUNT_AVATAR_SOURCE_MAX_BYTES + 1))).rejects.toMatchObject({ code: 'too-large' } satisfies Partial<AccountAvatarImageError>)
  })

  it('center-crops a landscape image, emits bounded WebP, and releases the bitmap', async () => {
    const close = vi.fn()
    const bitmap = { width: 1200, height: 800, close }
    vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap))
    const { canvas, drawImage } = stubCanvas()

    const result = await prepareAccountAvatar(imageFile())

    expect(result.type).toBe('image/webp')
    expect(result.size).toBeLessThanOrEqual(ACCOUNT_AVATAR_UPLOAD_MAX_BYTES)
    expect(canvas.width).toBe(512)
    expect(canvas.height).toBe(512)
    expect(drawImage).toHaveBeenCalledWith(bitmap, 200, 0, 800, 800, 0, 0, 512, 512)
    expect(close).toHaveBeenCalledOnce()
  })

  it('reduces quality and dimensions, then fails when every encoded result is too large', async () => {
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 800, height: 1200, close })))
    const { canvas } = stubCanvas(() => new Blob([new Uint8Array(ACCOUNT_AVATAR_UPLOAD_MAX_BYTES + 1)], { type: 'image/webp' }))

    await expect(prepareAccountAvatar(imageFile())).rejects.toMatchObject({ code: 'encode' } satisfies Partial<AccountAvatarImageError>)
    expect(canvas.toBlob).toHaveBeenCalledTimes(9)
    expect(canvas.width).toBe(320)
    expect(canvas.height).toBe(320)
    expect(close).toHaveBeenCalledOnce()
  })

  it('rejects excessive decoded pixel counts and still releases the bitmap', async () => {
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 10_000, height: 10_000, close })))
    stubCanvas()

    await expect(prepareAccountAvatar(imageFile())).rejects.toMatchObject({ code: 'decode' } satisfies Partial<AccountAvatarImageError>)
    expect(close).toHaveBeenCalledOnce()
  })
})
