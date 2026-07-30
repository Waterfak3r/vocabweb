import type { WordMeaning } from '../../domain/types'
import { PosBadge } from '../ui/Badge'

export type MeaningListProps = {
  meanings: WordMeaning[]
  showExamples?: boolean
}

/** Glosses with a left hairline — marginalia, not cards-in-cards. */
export function MeaningList({ meanings, showExamples = true }: MeaningListProps) {
  if (!meanings.length) return <p className="meaning-empty">暂无可用释义</p>
  return (
    <ol className="meaning-list">
      {meanings.map((meaning, index) => (
        <li className="meaning-item" key={`${meaning.pos}-${index}`}>
          <PosBadge pos={meaning.pos} />
          <div className="meaning-text">
            <p className="meaning-definition">{meaning.definition}</p>
            {showExamples && meaning.example && (
              <p className="meaning-example">{meaning.example}</p>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}
