import { isValidWordQuery, normalizeWord } from '../domain/normalize'
import type { WordEntry, WordMeaning } from '../domain/types'
import { LookupError, type WordRepository } from './wordRepository'

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

type BackendError = {
  code: string
  message: string
}

type BackendWordRepositoryOptions = {
  timeoutMs?: number
  fetch?: FetchLike
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseBackendError(value: unknown): BackendError | null {
  if (!isRecord(value) || !isRecord(value.error)) return null
  const { code, message } = value.error
  if (typeof code !== 'string' || typeof message !== 'string') return null
  return { code, message }
}

function mapBackendError(status: number, error: BackendError | null): LookupError {
  switch (error?.code) {
    case 'INVALID_WORD':
      return new LookupError('invalid-query', '只接受单个英文单词，可含连字符或撇号。')
    case 'UPSTREAM_TIMEOUT':
      return new LookupError('network', '词典响应超时，请重试。')
    case 'UPSTREAM_PARSE_ERROR':
      return new LookupError('parse', '词典返回的数据无法解析。')
    case 'UPSTREAM_ERROR':
      return new LookupError('http', '词典服务暂时不可用，请稍后重试。')
    case 'RATE_LIMITED':
      return new LookupError('http', '查询太频繁，请稍后再试。')
    default:
      return new LookupError('http', `词库服务暂时不可用（${status}）。`)
  }
}

function parseMeaning(value: unknown): WordMeaning | null {
  if (!isRecord(value)) return null
  if (typeof value.pos !== 'string' || typeof value.definition !== 'string') {
    return null
  }
  if (value.example !== undefined && typeof value.example !== 'string') {
    return null
  }

  const pos = value.pos.trim().toLowerCase()
  const definition = value.definition.trim()
  const example = value.example?.trim() || undefined
  if (!pos || !definition) return null

  return { pos, definition, example }
}

function parseAudioUrl(value: unknown): string | undefined | null {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !value.trim()) return null

  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

function parseBackendWordEntry(
  value: unknown,
  expectedWord: string,
): WordEntry | null {
  if (!isRecord(value)) return null
  if (
    typeof value.word !== 'string' ||
    typeof value.phonetic !== 'string' ||
    value.source !== 'backend' ||
    !Array.isArray(value.meanings) ||
    value.meanings.length === 0 ||
    value.meanings.length > 8
  ) {
    return null
  }

  const word = normalizeWord(value.word)
  if (!isValidWordQuery(word) || word !== expectedWord) return null

  const meanings = value.meanings.map(parseMeaning)
  if (meanings.some((meaning) => meaning === null)) return null

  const audioUrl = parseAudioUrl(value.audioUrl)
  if (audioUrl === null) return null

  return {
    word,
    phonetic: value.phonetic.trim(),
    audioUrl,
    meanings: meanings as WordMeaning[],
    source: 'backend',
  }
}

function buildApiBase(baseUrl: string): URL {
  const trimmed = baseUrl.trim()
  if (!trimmed) throw new TypeError('Backend API base URL must not be empty.')

  const url = new URL(trimmed)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError('Backend API base URL must use HTTP or HTTPS.')
  }

  url.search = ''
  url.hash = ''
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url
}

/** Backend dictionary client for GET /api/words/:word. */
export class BackendWordRepository implements WordRepository {
  private readonly baseUrl: URL
  private readonly timeoutMs: number
  private readonly fetch: FetchLike

  constructor(
    baseUrl: string,
    options: BackendWordRepositoryOptions = {},
  ) {
    this.baseUrl = buildApiBase(baseUrl)
    this.timeoutMs = options.timeoutMs ?? 8000
    this.fetch =
      options.fetch ??
      ((input, init) => globalThis.fetch(input, init))
  }

  async lookup(word: string): Promise<WordEntry | null> {
    const query = normalizeWord(word)
    if (!isValidWordQuery(query)) return null

    const path = `api/words/${encodeURIComponent(query)}`
    const url = new URL(path, this.baseUrl)

    let response: Response
    try {
      response = await this.fetch(url, {
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (cause) {
      const message =
        cause instanceof DOMException && cause.name === 'TimeoutError'
          ? '词库响应超时，请重试。'
          : '无法连接词库，请检查网络后重试。'
      throw new LookupError('network', message, { cause })
    }

    if (response.status === 404) return null

    let payload: unknown
    try {
      payload = await response.json()
    } catch (cause) {
      if (!response.ok) throw mapBackendError(response.status, null)
      throw new LookupError('parse', '词库返回的数据无法解析。', { cause })
    }

    if (!response.ok) {
      throw mapBackendError(response.status, parseBackendError(payload))
    }

    const entry = parseBackendWordEntry(payload, query)
    if (!entry) {
      throw new LookupError('parse', '词库返回的数据不符合预期。')
    }
    return entry
  }
}
