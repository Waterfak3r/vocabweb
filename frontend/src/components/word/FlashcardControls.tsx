import { Button } from '../ui/Button'

export type FlashcardControlsProps = {
  flipped: boolean
  onFlip: () => void
  onKnow: () => void
  onUnknown: () => void
  /** True until the card has been flipped — enforces recall */
  disableVerdicts: boolean
}

export function FlashcardControls({
  flipped,
  onFlip,
  onKnow,
  onUnknown,
  disableVerdicts,
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
    </div>
  )
}
