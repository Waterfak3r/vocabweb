export const MAX_IMPORT_FILE_BYTES = 1024 * 1024
export const MAX_IMPORT_ENTRIES = 500

export type ImportEntryStatus = 'ready' | 'invalid' | 'duplicate' | 'unmatched' | 'conflict'

export type ParsedImportEntry = {
  /** Original 1-based line number, so users can fix the source accurately. */
  line: number
  raw: string
  word: string
  zhMeaning?: string
  status: ImportEntryStatus
  reason?: string
}

export type ParsedImport = {
  entries: ParsedImportEntry[]
  acceptedCount: number
  batchCount: number
}

export type ImportTextFile = Pick<File, 'name' | 'size' | 'arrayBuffer' | 'text'>

const WORD = /^[A-Za-z]+(?:[-'’][A-Za-z]+)*$/
const SUPPORTED_FILE = /\.(?:txt|md|markdown|docx)$/i
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

  const firstSpace = cleaned.search(/\s/)
  const word = (firstSpace < 0 ? cleaned : cleaned.slice(0, firstSpace)).trim()
  const zhMeaning = (firstSpace < 0 ? '' : cleaned.slice(firstSpace).trim()) || undefined
  if (!WORD.test(word)) {
    return { line, raw, word, zhMeaning, status: 'invalid', reason: '首列必须是英文单词。' }
  }
  return { line, raw, word: word.toLowerCase(), zhMeaning, status: 'ready' }
}

/**
 * Parses the portable line format used by paste, TXT and Markdown imports.
 * The first space-delimited token is always the English word; the remaining
 * text (including spaces) remains the learner's Chinese definition.
 */
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
  if (!SUPPORTED_FILE.test(file.name)) return '请选择 TXT、Markdown 或 DOCX 文件。'
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
          .filter(Boolean)
        if (cells.length) lines.push(cells.join('\t'))
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
