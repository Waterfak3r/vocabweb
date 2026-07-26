import { useId, type InputHTMLAttributes, type Ref } from 'react'
import { cn } from '../../lib/cn'

export type TextFieldProps = {
  label: string
  hint?: string
  error?: string
  value: string
  onChange: (value: string) => void
  /** Visually quieter underline-only style (dictation answer) */
  mono?: boolean
  ref?: Ref<HTMLInputElement>
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'id' | 'value' | 'onChange'>

export function TextField({
  label,
  hint,
  error,
  value,
  onChange,
  mono = false,
  ref,
  ...rest
}: TextFieldProps) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`

  return (
    <div className={cn('field', error && 'field-error-state')}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        ref={ref}
        className={cn('field-input', mono && 'field-input-mono')}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : hint ? hintId : undefined}
        {...rest}
      />
      {hint && !error && (
        <p className="field-hint" id={hintId}>
          {hint}
        </p>
      )}
      {error && (
        <p className="field-error" id={errorId} role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
