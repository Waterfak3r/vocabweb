export const ACCOUNT_AVATAR_UPLOAD_MAX_BYTES = 512 * 1024
export const ACCOUNT_AVATAR_SOURCE_MAX_BYTES = Math.round(2.5 * 1024 * 1024)
export const ACCOUNT_AVATAR_SOURCE_MAX_LABEL = '2.5 MB'
export const ACCOUNT_AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
const ACCOUNT_AVATAR_SOURCE_MAX_DIMENSION = 12_000
const ACCOUNT_AVATAR_SOURCE_MAX_PIXELS = 64_000_000

export type AccountAvatarImageErrorCode = 'unsupported' | 'too-large' | 'decode' | 'encode'

export class AccountAvatarImageError extends Error {
  constructor(public readonly code: AccountAvatarImageErrorCode) {
    super(code)
    this.name = 'AccountAvatarImageError'
  }
}

type DecodedImage = {
  source: CanvasImageSource
  width: number
  height: number
  release: () => void
}

async function decodeImage(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file)
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close(),
    }
  }

  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.decoding = 'async'
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new AccountAvatarImageError('decode'))
      image.src = url
    })
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    }
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', quality))
}

/** Center-crops and re-encodes locally, keeping EXIF and oversized originals off the server. */
export async function prepareAccountAvatar(file: File): Promise<Blob> {
  if (!ACCOUNT_AVATAR_TYPES.includes(file.type as (typeof ACCOUNT_AVATAR_TYPES)[number])) {
    throw new AccountAvatarImageError('unsupported')
  }
  if (file.size <= 0 || file.size > ACCOUNT_AVATAR_SOURCE_MAX_BYTES) {
    throw new AccountAvatarImageError('too-large')
  }

  let decoded: DecodedImage
  try {
    decoded = await decodeImage(file)
  } catch (error) {
    if (error instanceof AccountAvatarImageError) throw error
    throw new AccountAvatarImageError('decode')
  }

  try {
    if (
      decoded.width < 1
      || decoded.height < 1
      || decoded.width > ACCOUNT_AVATAR_SOURCE_MAX_DIMENSION
      || decoded.height > ACCOUNT_AVATAR_SOURCE_MAX_DIMENSION
      || decoded.width * decoded.height > ACCOUNT_AVATAR_SOURCE_MAX_PIXELS
    ) throw new AccountAvatarImageError('decode')

    const cropSize = Math.min(decoded.width, decoded.height)
    const cropX = (decoded.width - cropSize) / 2
    const cropY = (decoded.height - cropSize) / 2
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) throw new AccountAvatarImageError('encode')

    for (const size of [512, 384, 320]) {
      canvas.width = size
      canvas.height = size
      context.clearRect(0, 0, size, size)
      context.drawImage(decoded.source, cropX, cropY, cropSize, cropSize, 0, 0, size, size)
      for (const quality of [0.86, 0.72, 0.58]) {
        const blob = await canvasBlob(canvas, quality)
        if (
          blob
          && ACCOUNT_AVATAR_TYPES.includes(blob.type as (typeof ACCOUNT_AVATAR_TYPES)[number])
          && blob.size > 0
          && blob.size <= ACCOUNT_AVATAR_UPLOAD_MAX_BYTES
        ) return blob
      }
    }
    throw new AccountAvatarImageError('encode')
  } finally {
    decoded.release()
  }
}
