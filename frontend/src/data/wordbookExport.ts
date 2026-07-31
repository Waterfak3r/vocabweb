import type { WordbookItem } from '../domain/types'

export const WORDBOOK_CSV_HEADER = ['单词', '音标', '词性', '英文释义', '中文释义', '例句'] as const

function csvCell(value: string) {
  const singleLine = value.replace(/\r?\n/g, ' ').trim()
  return `"${singleLine.replace(/"/g, '""')}"`
}

/**
 * Builds a spreadsheet-friendly CSV without private study state. Additional
 * meanings use continuation rows, so users only need to edit the headword once.
 */
export function wordbookToCsv(entries: readonly WordbookItem[]) {
  const rows = [WORDBOOK_CSV_HEADER.map(csvCell).join(',')]

  for (const entry of entries) {
    const meanings = entry.meanings.length ? entry.meanings : [undefined]
    meanings.forEach((meaning, index) => {
      rows.push([
        index === 0 ? entry.word : '',
        index === 0 ? entry.phonetic : '',
        meaning?.pos ?? '',
        meaning?.definition ?? '',
        index === 0 ? entry.zhMeaning ?? '' : '',
        meaning?.example ?? '',
      ].map(csvCell).join(','))
    })
  }

  return `\uFEFF${rows.join('\r\n')}\r\n`
}

export function wordbookCsvFilename(title: string) {
  const safeTitle = title
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 60) || '单词本'
  return `${safeTitle}-单词表.csv`
}
