import type { MonthSummary } from '@shared/types'
import { MONTH_NAMES, formatEur } from '@shared/money'

/** The full data remains in the adjacent accessible monthly table. */
export function CashflowChart({ months }: { months: MonthSummary[] }) {
  const maximum = Math.max(10000, ...months.flatMap((month) => [month.einnahmen, month.ausgaben]))
  const ceiling = Math.ceil(maximum / 10000) * 10000
  const width = 560, height = 194, left = 72, top = 12, bottom = 162
  const step = (width - left - 8) / Math.max(1, months.length)
  const bar = Math.min(12, step * 0.26)
  const y = (amount: number) => bottom - (amount / ceiling) * (bottom - top)
  return (
    <svg className="cashflow-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Einnahmen und Ausgaben im Kassenjahr">
      <title>Einnahmen und Ausgaben je Monat; genaue Werte in der Monatsübersicht darunter.</title>
      {[0, 0.5, 1].map((fraction) => <g key={fraction} className="chart-axis">
        <line x1={left} x2={width} y1={y(ceiling * fraction)} y2={y(ceiling * fraction)} />
        <text x={left - 8} y={y(ceiling * fraction) + 4} textAnchor="end">{new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(ceiling * fraction / 100)} €</text>
      </g>)}
      {months.map((month, index) => {
        const x = left + step * index + step / 2
        return <g key={`${month.year}-${month.month}`}>
          <title>{MONTH_NAMES[month.month - 1]} {month.year}: Einnahmen {formatEur(month.einnahmen)}, Ausgaben {formatEur(month.ausgaben)}</title>
          <rect x={x - bar - 1.5} y={y(month.einnahmen)} width={bar} height={bottom - y(month.einnahmen)} rx="2" fill="var(--color-accent)" />
          <rect x={x + 1.5} y={y(month.ausgaben)} width={bar} height={bottom - y(month.ausgaben)} rx="2" fill="var(--color-expense)" opacity="0.8" />
          <text x={x} y={height - 6} textAnchor="middle">{MONTH_NAMES[month.month - 1].slice(0, 3)}</text>
        </g>
      })}
    </svg>
  )
}
