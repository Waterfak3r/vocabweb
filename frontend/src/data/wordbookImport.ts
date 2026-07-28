export const MAX_IMPORT_FILE_BYTES = 1024 * 1024
export const MAX_IMPORT_ENTRIES = 500

export type ImportEntryStatus = 'ready' | 'invalid' | 'duplicate' | 'unmatched' | 'conflict'

export type ParsedImportEntry = {
  /** Original 1-based line number, so users can fix the source accurately. */
  line: number
  raw: string
  word: string
  pos?: string
  enDefinition?: string
  zhMeaning?: string
  example?: string
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

export function parseWordbookText(content: string): ParsedImport {
  const seen = new Set<string>()
  const entries: ParsedImportEntry[] = []
  let acceptedCount = 0

  content.replace(/^\uFEFF/, '').split(/\r?\n/).forEach((raw, index) => {
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
