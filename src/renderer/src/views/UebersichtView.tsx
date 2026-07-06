import { useStore } from '../store'
import { Amount } from '../components/Amount'
import { fiscalLabel } from '@shared/fiscal'
import { byCategory, monthSummaries, yearTotals } from '@shared/ledger'
import { MONTH_NAMES, formatEur } from '@shared/money'

export function UebersichtView({ onNavigate }: { onNavigate?: (view: 'bank' | 'buchungen') => void }) {
  const { file } = useStore()
  if (!file) return null
  const totals = yearTotals(file)
  const months = monthSummaries(file)
  const groups = byCategory(file)
  const activeMonths = months.filter((m) => m.count > 0)

  // Offene Arbeit: noch nicht übernommene Import-Umsätze
  const openImportRows = file.importDraft?.rows.length ?? 0

  return (
    <div className="view">
      <header className="view__header">
        <div>
          <h1 className="view__title">Übersicht {fiscalLabel(file)}</h1>
          <p className="view__subtitle">
            {totals.count} Buchungen · Anfangssaldo {formatEur(file.openingBalance)}
          </p>
        </div>
      </header>

      {openImportRows > 0 && (
        <div className="todo-tiles">
          <button className="todo-tile" onClick={() => onNavigate?.('bank')}>
            <span className="todo-tile__count">{openImportRows}</span>
            <span className="todo-tile__text">
              {openImportRows === 1 ? 'Umsatz wartet' : 'Umsätze warten'} auf Zuweisung
              <span className="todo-tile__hint">Jetzt zuweisen und übernehmen →</span>
            </span>
          </button>
        </div>
      )}

      <div className="stats">
        <div className="stat stat--hero">
          <div className="stat__label">Kassenstand</div>
          <div className="stat__value">{formatEur(totals.closingBalance)}</div>
          <div className="stat__hint">Anfangssaldo + Saldo aller Buchungen</div>
        </div>
        <div className="stat">
          <div className="stat__label">Einnahmen</div>
          <div className="stat__value amount--in">{formatEur(totals.einnahmen)}</div>
        </div>
        <div className="stat">
          <div className="stat__label">Ausgaben</div>
          <div className="stat__value amount--out">{formatEur(totals.ausgaben)}</div>
        </div>
        <div className="stat">
          <div className="stat__label">Umsatz</div>
          <div className="stat__value">{formatEur(totals.umsatz)}</div>
        </div>
      </div>

      <section className="card">
        <h2 className="card__title">Monatsübersicht</h2>
        {activeMonths.length === 0 ? (
          <div className="empty">
            <h3>Noch keine Buchungen</h3>
            <p>Erfasse die erste Buchung unter „Buchungen“ oder importiere einen Kontoauszug.</p>
          </div>
        ) : (
          <table className="ledger">
            <thead>
              <tr>
                <th>Monat</th>
                <th className="num">Einnahmen</th>
                <th className="num">Ausgaben</th>
                <th className="num">Saldo</th>
                <th className="num">Umsatz</th>
                <th className="num">Kassenstand</th>
              </tr>
            </thead>
            <tbody>
              {activeMonths.map((m) => (
                <tr key={`${m.year}-${m.month}`}>
                  <td>
                    {MONTH_NAMES[m.month - 1]}
                    {(file.fiscalStartMonth ?? 1) !== 1 && <span className="hint"> {m.year}</span>}
                  </td>
                  <td className="num"><Amount cents={m.einnahmen} /></td>
                  <td className="num"><Amount cents={-m.ausgaben} /></td>
                  <td className="num"><Amount cents={m.saldo} withSign /></td>
                  <td className="num"><Amount cents={m.umsatz} /></td>
                  <td className="num">{formatEur(m.balanceEnd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {groups.length > 0 && (
        <section className="card">
          <h2 className="card__title">Summen je Veranstaltung</h2>
          <table className="ledger">
            <thead>
              <tr>
                <th>Veranstaltung / Kategorie</th>
                <th className="num">Buchungen</th>
                <th className="num">Einnahmen</th>
                <th className="num">Ausgaben</th>
                <th className="num">Saldo</th>
                <th className="num">Umsatz</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.category.id}>
                  <td>{g.category.name}</td>
                  <td className="num">{g.rows.length}</td>
                  <td className="num"><Amount cents={g.einnahmen} /></td>
                  <td className="num"><Amount cents={-g.ausgaben} /></td>
                  <td className="num"><Amount cents={g.saldo} withSign /></td>
                  <td className="num"><Amount cents={g.umsatz} /></td>
                </tr>
              ))}
              <tr className="total-row">
                <td>Gesamt</td>
                <td className="num">{totals.count}</td>
                <td className="num"><Amount cents={totals.einnahmen} /></td>
                <td className="num"><Amount cents={-totals.ausgaben} /></td>
                <td className="num"><Amount cents={totals.saldo} withSign /></td>
                <td className="num"><Amount cents={totals.umsatz} /></td>
              </tr>
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}
