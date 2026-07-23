import { useState } from 'react'
import { selectHasWord, useWordbook } from '../../data/wordbookStore'
import type { WordEntry } from '../../domain/types'
import { Button } from '../ui/Button'

export type AddToWordbookButtonProps = {
  entry: WordEntry
}

export function AddToWordbookButton({ entry }: AddToWordbookButtonProps) {
  const saved = useWordbook(selectHasWord(entry.word))
  const add = useWordbook((state) => state.add)
  const [announcement, setAnnouncement] = useState('')

  function handleAdd() {
    if (add(entry)) {
      setAnnouncement(`已把 ${entry.word} 放入单词本。`)
    }
  }

  return (
    <span className="add-to-wordbook">
      <Button variant={saved ? 'ghost' : 'primary'} onClick={handleAdd} disabled={saved}>
        {saved ? '已收入' : '收入单词本'}
      </Button>
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </span>
  )
}
