export type FlashcardControlsProps = {
  flipped: boolean
  onFlip: () => void
  onKnow: () => void
  onUnknown: () => void
  nextReviewDays?: number
}

export function FlashcardControls({
  flipped,
  onFlip,
  onKnow,
  onUnknown,
  nextReviewDays,
}: FlashcardControlsProps) {
  return (
    <div className="study-actions study-verdicts">
      <button className="study-verdict unknown" type="button" onClick={onUnknown}>
        <span>不认识</span>
        <i aria-hidden="true" />
      </button>
      {!flipped && (
        <button className="study-flip" type="button" onClick={onFlip}>
          翻面
        </button>
      )}
      <button className="study-verdict known" type="button" onClick={onKnow}>
        <span>认识</span>
        <i aria-hidden="true" />
      </button>
      {nextReviewDays !== undefined && (
        <p className="study-next-review-hint">
          认识后进入「初识」，约 {nextReviewDays} 天后复习
        </p>
      )}
    </div>
  )
}
