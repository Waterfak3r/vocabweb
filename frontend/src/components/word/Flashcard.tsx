import type { WordbookItem } from '../../domain/types'
import { MeaningList } from './MeaningList'
import { PronounceButton } from './PronounceButton'
import styles from './Flashcard.module.css'

export type FlashcardProps = {
  item: WordbookItem
  flipped: boolean
  onFlip: () => void
}

/**
 * 3D flip card — the single choreographed motion of the app.
 * Front: the word alone, for recall. Back: the glosses.
 */
export function Flashcard({ item, flipped, onFlip }: FlashcardProps) {
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
          {item.phonetic && <span className={styles.phonetic}>{item.phonetic}</span>}
          <span className={styles.hint}>先想词义，再翻面</span>
        </span>

        <span className={`${styles.face} ${styles.back}`} aria-hidden={!flipped}>
          <span className={styles.faceLabel}>释义</span>
          <span className={styles.backWord}>{item.word}</span>
          <span className={styles.meanings}>
            <MeaningList meanings={item.meanings.slice(0, 3)} showExamples={false} />
          </span>
        </span>
      </button>

      <div className={styles.cardActions}>
        <PronounceButton word={item.word} audioUrl={item.audioUrl} />
      </div>
    </div>
  )
}
