import type { WordbookItem as WordbookItemType } from '../../domain/types'
import { Button } from '../ui/Button'
import { PosBadge } from '../ui/Badge'
import { PronounceButton } from './PronounceButton'

export type WordbookItemProps = {
  item: WordbookItemType
  onRemove: (id: string) => void
}

export function WordbookItem({ item, onRemove }: WordbookItemProps) {
  const firstMeaning = item.meanings[0]

  return (
    <li className="wordbook-row">
      <div className="wordbook-row-main">
        <div className="wordbook-row-top">
          <span className="wordbook-row-word">{item.word}</span>
          {item.phonetic && (
            <span className="wordbook-row-phonetic">{item.phonetic}</span>
          )}
        </div>
        {firstMeaning && (
          <p className="wordbook-row-gloss">
            <PosBadge pos={firstMeaning.pos} /> {firstMeaning.definition}
          </p>
        )}
      </div>

      <div className="wordbook-row-actions">
        <PronounceButton word={item.word} audioUrl={item.audioUrl} />
        <Button variant="danger" size="sm" onClick={() => onRemove(item.id)}>
          移除
        </Button>
      </div>
    </li>
  )
}
