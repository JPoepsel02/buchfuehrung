import { formatAmount, formatEur } from '@shared/money'
import type { Cents } from '@shared/types'

/** Vorzeichenbehafteter Betrag mit semantischer Farbe. */
export function Amount({ cents, withSign = false, currency = false }: { cents: Cents; withSign?: boolean; currency?: boolean }) {
  const cls = cents > 0 ? 'amount--in' : cents < 0 ? 'amount--out' : ''
  const text = currency ? formatEur(cents) : formatAmount(cents)
  return <span className={cls}>{withSign && cents > 0 ? '+' : ''}{text}</span>
}
