import type { WordEntry, WordMeaning } from './types'

export type MeaningLanguagePreference = 'zh' | 'en'

const HAS_HAN = /[\u3400-\u9fff]/

function cleanMeanings(meanings: readonly WordMeaning[]): WordMeaning[] {
  return meanings.flatMap((meaning) => {
    const definition = meaning.definition.trim()
    if (!definition) return []
    const example = meaning.example?.trim()
    return [{
      pos: meaning.pos.trim() || 'unknown',
      definition,
      ...(example ? { example } : {}),
      ...(meaning.sourceId ? { sourceId: meaning.sourceId } : {}),
    }]
  })
}

/**
 * Selects valid definitions for one word. The preference is per-card presentation only: when that
 * language is absent, the other language is returned without mutating the learner's global choice.
 */
export function selectPreferredMeanings(
  item: Pick<WordEntry, 'meanings' | 'zhMeaning'>,
  preference: MeaningLanguagePreference,
  limit = 3,
): WordMeaning[] {
  const meanings = cleanMeanings(item.meanings)
  const english = meanings.filter((meaning) => !HAS_HAN.test(meaning.definition))
  const embeddedChinese = meanings.filter((meaning) => HAS_HAN.test(meaning.definition))
  const zhMeaning = item.zhMeaning?.trim()
  const dedicatedChinese = zhMeaning
    ? [{ pos: '中文', definition: zhMeaning }]
    : []
  const chinese = dedicatedChinese.length ? dedicatedChinese : embeddedChinese
  const selected = preference === 'zh'
    ? (chinese.length ? chinese : english)
    : (english.length ? english : chinese)
  return selected.slice(0, Math.max(0, limit))
}

export function firstAvailableMeaning(
  item: Pick<WordEntry, 'meanings' | 'zhMeaning'>,
  preference: MeaningLanguagePreference = 'zh',
): WordMeaning | undefined {
  return selectPreferredMeanings(item, preference, 1)[0]
}
