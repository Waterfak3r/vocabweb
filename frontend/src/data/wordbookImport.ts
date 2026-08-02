export const MAX_IMPORT_FILE_BYTES = 1024 * 1024
export const MAX_IMPORT_ENTRIES = 500
export const MAX_IMPORT_TOTAL_ENTRIES = MAX_IMPORT_ENTRIES * 20

export type ImportEntryStatus = 'ready' | 'invalid' | 'duplicate' | 'unmatched' | 'conflict'

export type ParsedImportEntry = {
  /** Original 1-based line number, so users can fix the source accurately. */
  line: number
  raw: string
  word: string
  phonetic?: string
  pos?: string
  enDefinition?: string
  zhMeaning?: string
  example?: string
  meanings?: Array<{ pos: string; definition: string; example?: string }>
  status: ImportEntryStatus
  reason?: string
}

export type ParsedImport = {
  entries: ParsedImportEntry[]
  acceptedCount: number
  batchCount: number
}

export type ImportTextFile = Pick<File, 'name' | 'size' | 'arrayBuffer' | 'text'>

const SUPPORTED_FILE = /\.(?:csv|txt|md|markdown|docx)$/i
const DOCX_FILE = /\.docx$/i
const STRUCTURED_CSV_HEADERS = [
  ['单词', '音标', '词性', '英文释义', '中文释义', '例句'],
  ['word', 'phonetic', 'pos', 'endefinition', 'zhmeaning', 'example'],
] as const

function markdownLine(line: string) {
  return line
    .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, '')
    .replace(/^\s*\[[ xX]\]\s+/, '')
    .trim()
}

function parseLine(raw: string, line: number): ParsedImportEntry | null {
  const cleaned = markdownLine(raw)
  if (!cleaned) return null

  const parsed = parseCsvRow(cleaned)
  if (typeof parsed === 'string') {
    return { line, raw, word: '', status: 'invalid', reason: parsed }
  }
  if (parsed.length > 5) {
    return { line, raw, word: parsed[0]?.trim() ?? '', status: 'invalid', reason: '每行最多包含五列。' }
  }
  const [rawWord = '', rawPos = '', rawEnDefinition = '', rawZhMeaning = '', rawExample = ''] = parsed
  const word = normalizeWord(rawWord)
  const pos = rawPos.trim() || undefined
  const enDefinition = rawEnDefinition.trim() || undefined
  const zhMeaning = rawZhMeaning.trim() || undefined
  const example = rawExample.trim() || undefined
  const base = { line, raw, word, ...(pos ? { pos } : {}), ...(enDefinition ? { enDefinition } : {}), ...(zhMeaning ? { zhMeaning } : {}), ...(example ? { example } : {}) }
  if (!isValidWordQuery(word)) {
    return { ...base, status: 'invalid', reason: '首列必须是合法的英文单词或词组。' }
  }
  if ((pos?.length ?? 0) > 80 || (enDefinition?.length ?? 0) > 1500 || (zhMeaning?.length ?? 0) > 1000 || (example?.length ?? 0) > 1500) {
    return { ...base, status: 'invalid', reason: '字段内容过长，请缩短后重试。' }
  }
  return { ...base, status: 'ready' }
}

/**
 * Parses one RFC-4180-style CSV record. Imports deliberately do not support
 * embedded newlines inside quoted fields because each source line is one word.
 */
function parseCsvRow(value: string): string[] | string {
  const fields: string[] = []
  let field = ''
  let quoted = false
  let closedQuote = false
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!
    if (quoted) {
      if (character === '"' && value[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (character === '"') {
        quoted = false
        closedQuote = true
      } else {
        field += character
      }
      continue
    }
    if (character === ',' && !quoted) {
      fields.push(field)
      field = ''
      closedQuote = false
      continue
    }
    if (character === '"' && !field.trim() && !closedQuote) {
      field = ''
      quoted = true
      continue
    }
    if (closedQuote && !/\s/.test(character)) return '双引号字段结束后只能出现逗号。'
    field += character
  }
  if (quoted) return '双引号字段没有正确结束。'
  fields.push(field)
  return fields
}

function isStructuredCsvHeader(fields: readonly string[]) {
  const normalized = fields.map((field) => field.trim().toLowerCase())
  return STRUCTURED_CSV_HEADERS.some((header) => header.every((field, index) => normalized[index] === field))
}

/**
 * Parses the six-column CSV emitted by wordbookExport. Blank headword cells are
 * continuation meanings for the preceding word, which keeps spreadsheet edits
 * compact while preserving every public meaning on a round trip.
 */
function parseStructuredCsv(content: string): ParsedImport | null {
  const lines = content.split(/\r?\n/)
  const headerIndex = lines.findIndex((line) => line.trim())
  if (headerIndex < 0) return null
  const header = parseCsvRow(lines[headerIndex]!)
  if (typeof header === 'string' || !isStructuredCsvHeader(header)) return null

  const grouped: ParsedImportEntry[] = []
  let current: ParsedImportEntry | null = null
  const flush = () => {
    if (!current) return
    if (!current.meanings?.length) delete current.meanings
    grouped.push(current)
    current = null
  }

  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const raw = lines[index]!
    if (!raw.trim()) continue
    const parsed = parseCsvRow(raw)
    if (typeof parsed === 'string' || parsed.length > 6) {
      flush()
      grouped.push({ line: index + 1, raw, word: '', status: 'invalid', reason: typeof parsed === 'string' ? parsed : '结构化 CSV 每行最多包含六列。' })
      continue
    }

    const [rawWord = '', rawPhonetic = '', rawPos = '', rawDefinition = '', rawZhMeaning = '', rawExample = ''] = parsed
    const normalizedWord = normalizeWord(rawWord)
    const continuation = !rawWord.trim()
    if (!continuation) {
      flush()
      current = {
        line: index + 1,
        raw,
        word: normalizedWord,
        ...(rawPhonetic.trim() ? { phonetic: rawPhonetic.trim() } : {}),
        ...(rawZhMeaning.trim() ? { zhMeaning: rawZhMeaning.trim() } : {}),
        meanings: [],
        status: isValidWordQuery(normalizedWord) ? 'ready' : 'invalid',
        ...(!isValidWordQuery(normalizedWord) ? { reason: '首列必须是合法的英文单词或词组。' } : {}),
      }
    } else if (!current) {
      grouped.push({ line: index + 1, raw, word: '', status: 'invalid', reason: '释义续行前必须先填写单词。' })
      continue
    } else {
      current.raw += `\n${raw}`
      if (!current.phonetic && rawPhonetic.trim()) current.phonetic = rawPhonetic.trim()
      if (!current.zhMeaning && rawZhMeaning.trim()) current.zhMeaning = rawZhMeaning.trim()
    }

    if (!current) continue
    const pos = rawPos.trim()
    const definition = rawDefinition.trim()
    const example = rawExample.trim()
    if (pos || definition || example) {
      current.meanings!.push({
        pos: pos || 'unknown',
        definition,
        ...(example ? { example } : {}),
      })
    }
    if (
      (current.phonetic?.length ?? 0) > 120
      || (current.zhMeaning?.length ?? 0) > 1000
      || pos.length > 80
      || definition.length > 1500
      || example.length > 1500
    ) {
      current.status = 'invalid'
      current.reason = '字段内容过长，请缩短后重试。'
    }
  }
  flush()

  const entries: ParsedImportEntry[] = []
  const byWord = new Map<string, ParsedImportEntry>()
  for (const entry of grouped) {
    if (entry.status !== 'ready') {
      entries.push(entry)
      continue
    }
    const existing = byWord.get(entry.word)
    if (!existing) {
      byWord.set(entry.word, entry)
      entries.push(entry)
      continue
    }
    existing.raw += `\n${entry.raw}`
    existing.phonetic ||= entry.phonetic
    existing.zhMeaning ||= entry.zhMeaning
    if (entry.meanings?.length) existing.meanings = [...(existing.meanings ?? []), ...entry.meanings]
  }

  const acceptedCount = byWord.size
  return { entries, acceptedCount, batchCount: Math.ceil(acceptedCount / MAX_IMPORT_ENTRIES) }
}

export function parseWordbookText(content: string): ParsedImport {
  const normalizedContent = content.replace(/^\uFEFF/, '')
  const structured = parseStructuredCsv(normalizedContent)
  if (structured) return structured
  const seen = new Set<string>()
  const entries: ParsedImportEntry[] = []
  let acceptedCount = 0

  normalizedContent.split(/\r?\n/).forEach((raw, index) => {
    const entry = parseLine(raw, index + 1)
    if (!entry) return
    if (entry.status === 'ready') {
      if (seen.has(entry.word)) {
        entry.status = 'duplicate'
        entry.reason = '与本次导入中的前一词重复。'
      } else {
        seen.add(entry.word)
        acceptedCount += 1
      }
    }
    entries.push(entry)
  })

  return { entries, acceptedCount, batchCount: Math.ceil(acceptedCount / MAX_IMPORT_ENTRIES) }
}

export function validateImportFile(file: Pick<File, 'name' | 'size'>): string | null {
  if (!SUPPORTED_FILE.test(file.name)) return '请选择 CSV、TXT、Markdown 或 DOCX 文件。'
  if (file.size > MAX_IMPORT_FILE_BYTES) return '单个文件不能超过 1MB。'
  return null
}

export function validateImportText(content: string): string | null {
  return new TextEncoder().encode(content).byteLength > MAX_IMPORT_FILE_BYTES
    ? '单次导入文本不能超过 1MB；请拆分后再导入。'
    : null
}

export function validateImportEntryCount(count: number): string | null {
  return count > MAX_IMPORT_TOTAL_ENTRIES
    ? `单次最多导入 ${MAX_IMPORT_TOTAL_ENTRIES.toLocaleString('en-US')} 条记录，请拆分后重试。`
    : null
}

function textFromHtml(html: string) {
  const document = new DOMParser().parseFromString(html, 'text/html')
  const lines: string[] = []
  for (const element of Array.from(document.body.children)) {
    if (element.tagName === 'TABLE') {
      for (const row of Array.from(element.querySelectorAll('tr'))) {
        const cells = Array.from(row.querySelectorAll('th, td'))
          .map((cell) => cell.textContent?.replace(/\s+/g, ' ').trim() ?? '')
        if (cells.some(Boolean)) lines.push(cells.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(','))
      }
      continue
    }
    if (element.tagName === 'UL' || element.tagName === 'OL') {
      for (const item of Array.from(element.querySelectorAll(':scope > li'))) {
        const text = item.textContent?.replace(/\s+/g, ' ').trim()
        if (text) lines.push(text)
      }
      continue
    }
    const text = element.textContent?.replace(/\s+/g, ' ').trim()
    if (text) lines.push(text)
  }
  return lines.join('\n')
}

/** Reads source content in the browser without uploading the original file. */
export async function readImportFile(file: ImportTextFile): Promise<string> {
  const error = validateImportFile(file)
  if (error) throw new Error(error)
  if (!DOCX_FILE.test(file.name)) return file.text()

  // DOCX conversion is needed rarely, so keep Mammoth outside the initial app bundle.
  const { default: mammoth } = await import('mammoth')
  const result = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() })
  return textFromHtml(result.value)
}
import { isValidWordQuery, normalizeWord } from '../domain/normalize'
