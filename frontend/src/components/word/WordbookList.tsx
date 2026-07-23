import type { WordbookItem as WordbookItemType } from '../../domain/types'
import { WordbookItem } from './WordbookItem'

export type WordbookListProps = {
  items: WordbookItemType[]
  onRemove: (id: string) => void
}

export function WordbookList({ items, onRemove }: WordbookListProps) {
  return (
    <ul className="wordbook-list">
      {items.map((item) => (
        <WordbookItem key={item.id} item={item} onRemove={onRemove} />
      ))}
    </ul>
  )
}
