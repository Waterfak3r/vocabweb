export type ProgressBarProps = {
  /** 1-based current step */
  value: number
  max: number
  label: string
}

/** A 2px pencil line with a mono counter. */
export function ProgressBar({ value, max, label }: ProgressBarProps) {
  const clamped = Math.min(Math.max(value, 0), max)
  const percent = max > 0 ? (clamped / max) * 100 : 0

  return (
    <div className="progress">
      <div
        className="progress-track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={clamped}
      >
        <div className="progress-fill" style={{ width: `${percent}%` }} />
      </div>
      <span className="progress-count">
        {clamped} / {max}
      </span>
    </div>
  )
}
