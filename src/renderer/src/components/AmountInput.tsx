import { useState } from 'react'
import { formatAmount, parseAmountToCents } from '@shared/money'

/**
 * Betrags-Eingaben: lassen nur Ziffern, Komma und Punkt zu und normalisieren
 * beim Verlassen auf das deutsche Format ("1.234,56").
 */

type BaseProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>

/** String-gesteuertes Betragsfeld für Formulare, die den Rohtext halten. */
export function AmountField({
  value,
  onChange,
  invalid,
  onBlur,
  ...rest
}: BaseProps & { value: string; onChange: (value: string) => void; invalid?: boolean }) {
  return (
    <input
      {...rest}
      value={value}
      inputMode="decimal"
      onChange={(e) => onChange(e.target.value.replace(/[^0-9.,]/g, ''))}
      onBlur={(e) => {
        const cents = parseAmountToCents(e.target.value)
        if (cents !== null && e.target.value.trim()) onChange(formatAmount(cents))
        onBlur?.(e)
      }}
      aria-invalid={invalid || (value.trim() !== '' && parseAmountToCents(value) === null)}
    />
  )
}

/** Cent-gesteuertes Betragsfeld: hält den Text lokal und meldet gültige Cent-Werte. */
export function CentsAmountInput({
  cents,
  onCommit,
  invalid,
  ...rest
}: BaseProps & { cents: number; onCommit: (cents: number) => void; invalid?: boolean }) {
  const [value, setValue] = useState(() => formatAmount(cents))

  function commit() {
    const parsed = parseAmountToCents(value)
    if (parsed === null || parsed < 0) {
      setValue(formatAmount(cents))
      return
    }
    onCommit(parsed)
    setValue(formatAmount(parsed))
  }

  return (
    <input
      {...rest}
      value={value}
      inputMode="decimal"
      onChange={(e) => setValue(e.target.value.replace(/[^0-9.,]/g, ''))}
      onBlur={commit}
      aria-invalid={invalid}
    />
  )
}
