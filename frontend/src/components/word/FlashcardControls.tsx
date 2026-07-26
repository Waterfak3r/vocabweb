import { Button } from '../ui/Button'

export type FlashcardControlsProps = {
  flipped: boolean
  onFlip: () => void
  onKnow: () => void
  onUnknown: () => void
  /** True until the card has been flipped — enforces recall */
  disableVerdicts: boolean
  /** 标熟: drops the card from the queue for good. Absent in local mode — button not rendered. */
  onMastered?: () => void
}

export function FlashcardControls({
  flipped,
  onFlip,
  onKnow,
  onUnknown,
  disableVerdicts,
  onMastered,
}: FlashcardControlsProps) {
  return (
    <div className="study-actions">
      <Button variant="danger" onClick={onUnknown} disabled={disableVerdicts}>
        不熟
      </Button>
      {!flipped && (
        <Button variant="secondary" onClick={onFlip}>
          翻面
        </Button>
      )}
      <Button variant="primary" onClick={onKnow} disabled={disableVerdicts}>
        掌握
      </Button>
      {onMastered && flipped && (
        <Button variant="ghost" size="sm" onClick={onMastered}>
          已熟，移出学习
        </Button>
      )}
    </div>
  )
}
