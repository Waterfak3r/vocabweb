import type { WordEntry } from '../../domain/types'
import { AddToWordbookButton } from './AddToWordbookButton'
import { MeaningList } from './MeaningList'
import { PronounceButton } from './PronounceButton'
import { WordHeadword } from './WordHeadword'
import styles from './WordResultCard.module.css'

export type WordResultCardProps = {
  entry: WordEntry
  /** Show the add-to-wordbook action (false on wordbook rows) */
  showAddAction?: boolean
}

/** A full dictionary entry, set like a page from a pocket dictionary. */
export function WordResultCard({ entry, showAddAction = true }: WordResultCardProps) {
  return (
    <article className={`${styles.card} home-word-card`}>
      <header className={styles.header}>
        <WordHeadword word={entry.word} phonetic={entry.phonetic} source={entry.source} />
        <PronounceButton word={entry.word} audioUrl={entry.audioUrl} />
      </header>

      <hr className={styles.rule} />

      <MeaningList meanings={entry.meanings} />

      {showAddAction && (
        <>
          <hr className={styles.rule} />
          <footer className={styles.actions}>
            <AddToWordbookButton entry={entry} />
          </footer>
        </>
      )}
    </article>
  )
}
