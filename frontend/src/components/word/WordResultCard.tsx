import { useEffect, useMemo, useState } from 'react'
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
  const available = useMemo(() => entry.availableLanguages ?? [
    ...(entry.zhMeaning ? ['zh' as const] : []),
    ...(entry.meanings.length ? ['en' as const] : []),
  ], [entry.availableLanguages, entry.meanings.length, entry.zhMeaning])
  const [language, setLanguage] = useState<'zh' | 'en'>(() => {
    try {
      const stored = localStorage.getItem('vocab-dictionary-language-v1')
      if (stored === 'en' || stored === 'zh') return stored
    } catch { /* Storage is optional. */ }
    return 'zh'
  })
  const activeLanguage = available.includes(language) ? language : available[0] ?? 'en'

  useEffect(() => {
    if (activeLanguage !== language) setLanguage(activeLanguage)
  }, [activeLanguage, language])

  function chooseLanguage(next: 'zh' | 'en') {
    if (!available.includes(next)) return
    setLanguage(next)
    try { localStorage.setItem('vocab-dictionary-language-v1', next) } catch { /* Storage is optional. */ }
  }

  return (
    <article className={`${styles.card} home-word-card`}>
      <header className={styles.header}>
        <WordHeadword word={entry.word} phonetic={entry.phonetic} source={entry.source} />
        <PronounceButton word={entry.word} audioUrl={entry.audioUrl} />
      </header>

      <hr className={styles.rule} />

      <div className="dictionary-language-row">
        <div className="dictionary-language-switch" role="group" aria-label="释义语言">
          <button type="button" className={activeLanguage === 'zh' ? 'active' : ''} disabled={!available.includes('zh')} onClick={() => chooseLanguage('zh')}>中文释义</button>
          <button type="button" className={activeLanguage === 'en' ? 'active' : ''} disabled={!available.includes('en')} onClick={() => chooseLanguage('en')}>English</button>
        </div>
        {entry.sources?.length ? <span className="dictionary-source-note">{activeLanguage === 'zh' ? 'ECDICT' : entry.sources.some((source) => source.id === 'open_english_wordnet') ? 'OEWN 2025' : '在线补充'}</span> : null}
      </div>
      {activeLanguage === 'zh' && entry.zhMeaning ? (
        <div className="chinese-meaning-list">
          {entry.zhMeaning.split(/\n+/).filter(Boolean).map((line, index) => <p key={`${line}-${index}`}>{line}</p>)}
        </div>
      ) : (
        <MeaningList meanings={entry.meanings} />
      )}

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
