import { useStore } from '../store'
import { Amount } from '../components/Amount'
import { fiscalEndLabel, fiscalLabel, prevFiscalEndLabel } from '@shared/fiscal'
import { chronological, yearTotals } from '@shared/ledger'
import { formatDate, formatEur } from '@shared/money'

/** Alle Buchungen chronologisch mit laufendem Kassenstand – wie das Excel-Blatt. */
export function ChronoView() {
  const { file } = useStore()
  if (!file) return null
  const rows = chronological(file)
  const totals = yearTotals(file)

  return (
    <div className="view">
      <header className="view__header">
        <div>
          <h1 className="view__title">Chronologisch {fiscalLabel(file)}</h1>
          <p className="view__subtitle">Alle Buchungen nach Datum sortiert mit laufendem Kassenstand.</p>
        </div>
      </header>

      <section className="card">
        {rows.length === 0 ? (
          <div className="empty">
            <h3>Noch keine Buchungen</h3>
          </div>
        ) : (
          <table className="ledger">
            <thead>
              <tr>
                <th>Datum</th>
                <th>Nr.</th>
                <th>Name</th>
                <th>Verwendungszweck</th>
                <th className="num">Ausgaben (€)</th>
                <th className="num">Einnahmen (€)</th>
                <th className="num">Umsatz (€)</th>
                <th className="num">Kassenstand (€)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatDate(r.date)}</td>
                  <td className="ref">{r.ref}</td>
                  <td>{r.name?.trim() || '–'}</td>
                  <td className="cell-desc">{r.description}</td>
                  <td className="num">{r.type === 'ausgabe' ? <Amount cents={-r.amount} /> : ''}</td>
                  <td className="num">{r.type === 'einnahme' ? <Amount cents={r.amount} /> : ''}</td>
                  <td className="num">{r.isUmsatz ? <Amount cents={r.umsatzAmount} /> : ''}</td>
                  <td className="num">{formatEur(r.runningBalance)}</td>
                </tr>
              ))}
              <tr className="total-row">
                <td colSpan={4}>Abschlusssaldo {prevFiscalEndLabel(file)}</td>
                <td colSpan={4} className="num">{formatEur(file.openingBalance)}</td>
              </tr>
              <tr className="total-row">
                <td colSpan={4}>+ Gesamtsaldo {fiscalLabel(file)}</td>
                <td colSpan={4} className="num">
                  <Amount cents={totals.saldo} withSign currency />
                </td>
              </tr>
              <tr className="total-row">
                <td colSpan={4}>Abschlusssaldo {fiscalEndLabel(file)}</td>
                <td colSpan={4} className="num">{formatEur(totals.closingBalance)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
