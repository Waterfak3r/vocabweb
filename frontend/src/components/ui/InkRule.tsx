/** Hairline section divider with an optional marginal label. */
export function InkRule({ label }: { label?: string }) {
  if (!label) return <hr className="ink-rule" />
  return (
    <div className="ink-rule-labeled" role="separator">
      <span className="marginal">{label}</span>
      <hr className="ink-rule" />
    </div>
  )
}
