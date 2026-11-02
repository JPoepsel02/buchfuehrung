import { Amount } from './Amount'
import { fiscalEndLabel, fiscalLabel, prevFiscalEndLabel } from '@shared/fiscal'
import { yearTotals } from '@shared/ledger'
import { formatDate, formatEur } from '@shared/money'
import type { ChronoRow, YearFile } from '@shared/types'

function AnnualSummary({ file }: { file: YearFile }) {
  const totals = yearTotals(file)
  return <>
    <tr className="total-row">
      <td colSpan={4}>Abschlusssaldo {prevFiscalEndLabel(file)}</td>
      <td colSpan={4} className="num">{formatEur(file.openingBalance)}</td>
    </tr>
    <tr className="total-row">
      <td colSpan={4}>+ Gesamtsaldo {fiscalLabel(file)}</td>
      <td colSpan={4} className="num"><Amount cents={totals.saldo} withSign currency /></td>
    </tr>
    <tr className="total-row">
      <td colSpan={4}>Abschlusssaldo {fiscalEndLabel(file)}</td>
      <td colSpan={4} className="num">{formatEur(totals.closingBalance)}</td>
    </tr>
  </>
}

/** Reine Leseansicht; Kassenstände stammen stets aus der vollständigen Chronologie. */
export function ChronologicalTable({ rows, summaryFile, emptyMessage = 'Keine Buchungen gefunden' }: {
  rows: readonly ChronoRow[]
  summaryFile?: YearFile
  emptyMessage?: string
}) {
  if (rows.length === 0) return <div className="empty"><h3>{emptyMessage}</h3></div>
  return (
    <table className="ledger chronological-table">
      <thead><tr>
        <th>Datum</th><th>Nr.</th><th>Name</th><th>Verwendungszweck</th>
        <th className="num">Ausgaben (€)</th><th className="num">Einnahmen (€)</th>
        <th className="num">Umsatz (€)</th><th className="num">Kassenstand (€)</th>
      </tr></thead>
      <tbody>
        {rows.map((row) => <tr key={row.id} data-booking-id={row.id}>
          <td style={{ whiteSpace: 'nowrap' }}>{formatDate(row.date)}</td>
          <td className="ref">{row.ref}</td>
          <td>{row.name?.trim() || '–'}</td>
          <td className="cell-desc">{row.description}</td>
          <td className="num">{row.type === 'ausgabe' ? <Amount cents={-row.amount} /> : ''}</td>
          <td className="num">{row.type === 'einnahme' ? <Amount cents={row.amount} /> : ''}</td>
          <td className="num">{row.isUmsatz ? <Amount cents={row.umsatzAmount} /> : ''}</td>
          <td className="num">{formatEur(row.runningBalance)}</td>
        </tr>)}
        {summaryFile && <AnnualSummary file={summaryFile} />}
      </tbody>
    </table>
  )
}
