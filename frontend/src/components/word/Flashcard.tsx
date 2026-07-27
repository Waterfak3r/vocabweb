import type { WordbookItem } from '../../domain/types'
import type { StudyDisplayPreferences } from '../../data/studyPreferences'
import { MeaningList } from './MeaningList'
import { PronounceButton } from './PronounceButton'
import styles from './Flashcard.module.css'

export type FlashcardProps = {
  item: WordbookItem
  flipped: boolean
  onFlip: () => void
  onMastered?: () => void
  preferences?: StudyDisplayPreferences
}

const HAS_HAN = /[\u3400-\u9fff]/

export function preferredMeanings(
  item: WordbookItem,
  preference: StudyDisplayPreferences['meaningPreference'],
) {
  if (preference === 'zh' && item.zhMeaning) {
    return [{ pos: '中文', definition: item.zhMeaning }]
  }
  const preferred = item.meanings.filter((meaning) => (
    preference === 'zh'
      ? HAS_HAN.test(meaning.definition)
      : !HAS_HAN.test(meaning.definition)
  ))
  return (preferred.length ? preferred : item.meanings).slice(0, 3)
}

/**
 * 3D flip card — the single choreographed motion of the app.
 * Front: the word alone, for recall. Back: the glosses.
 */
export function Flashcard({
  item,
  flipped,
  onFlip,
  onMastered,
  preferences = {
    meaningPreference: 'zh',
    showExamples: true,
    showPhonetic: true,
  },
}: FlashcardProps) {
  const meanings = preferredMeanings(item, preferences.meaningPreference)
  return (
    <div className={styles.stage}>
      <button
        type="button"
        className={`${styles.card} ${flipped ? styles.flipped : ''}`}
        onClick={onFlip}
        aria-pressed={flipped}
        aria-label={flipped ? `${item.word}，已翻面，点击回到词头` : `${item.word}，点击翻面看释义`}
      >
        <span className={`${styles.face} ${styles.front}`} aria-hidden={flipped}>
          <span className={styles.faceLabel}>词头</span>
          <span className={styles.word}>{item.word}</span>
          {preferences.showPhonetic && item.phonetic && <span className={styles.phonetic}>{item.phonetic}</span>}
          <span className={styles.hint}>先想词义，再翻面</span>
        </span>

        <span className={`${styles.face} ${styles.back}`} aria-hidden={!flipped}>
          <span className={styles.faceLabel}>释义</span>
          <span className={styles.backWord}>{item.word}</span>
          <span className={styles.meanings}>
            <MeaningList meanings={meanings} showExamples={preferences.showExamples} />
          </span>
        </span>
      </button>

      {onMastered && flipped && (
        <button
          type="button"
          className={styles.mastered}
          aria-label={`将 ${item.word} 标为已熟并移出学习`}
          title="已熟，移出学习"
          onClick={onMastered}
        >
          熟
        </button>
      )}

      <div className={styles.cardActions}>
        <PronounceButton word={item.word} audioUrl={item.audioUrl} />
      </div>
    </div>
  )
}
