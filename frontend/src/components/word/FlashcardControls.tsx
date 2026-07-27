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
    <div className="study-actions study-verdicts">
      <button className="study-verdict unknown" type="button" onClick={onUnknown} disabled={disableVerdicts}>
        <span>不认识</span>
        <i aria-hidden="true" />
      </button>
      {!flipped && (
        <button className="study-flip" type="button" onClick={onFlip}>
          翻面
        </button>
      )}
      <button className="study-verdict known" type="button" onClick={onKnow} disabled={disableVerdicts}>
        <span>认识</span>
        <i aria-hidden="true" />
      </button>
    </div>
  )
}
