import { useStore } from '../store'
import { Amount } from '../components/Amount'
import { Icon } from '../components/Icon'
import { CashflowChart } from '../components/CashflowChart'
import { fiscalLabel } from '@shared/fiscal'
import { byCategory, computeBookings, monthSummaries, yearTotals } from '@shared/ledger'
import { newImportRows } from '@shared/importRows'
import { MONTH_NAMES, formatDate, formatEur } from '@shared/money'
import { calendarMonthFilters } from '../bookingFilters'
import type { BookingFilterPreset } from '../bookingFilters'

type OverviewTarget = 'buchungen' | 'import'

export function UebersichtView({ onNavigate, onOpenBooking }: {
  onNavigate?: (view: OverviewTarget, filters?: BookingFilterPreset) => void
  onOpenBooking?: (id: string) => void
}) {
  const { file } = useStore()
  if (!file) return null
  const totals = yearTotals(file)
  const months = monthSummaries(file)
  const groups = byCategory(file)
  const activeMonths = months.filter((m) => m.count > 0)
  const recent = computeBookings(file).sort((a, b) => b.date.localeCompare(a.date) || b.seq - a.seq).slice(0, 4)
  const openImportRows = newImportRows(file).length

  return (
    <div className="view overview-view">
      <header className="view__header overview-heading">
        <div>
          <span className="overview-kicker">Dein Verein. Alles im Blick.</span>
          <h1 className="view__title">Übersicht {fiscalLabel(file)}</h1>
          <p className="view__subtitle">Dein Kassenjahr auf einen Blick · {totals.count} Buchungen</p>
        </div>
        <div className="overview-actions">
          <button className="btn" onClick={() => onNavigate?.('import')}>
            <Icon name="import" size={16} />
            <span className="import-action__text"><span>{openImportRows > 0 ? 'Import weiterführen' : 'Umsätze importieren'}</span>
              {openImportRows > 0 && <small>{openImportRows} {openImportRows === 1 ? 'Umsatz wartet' : 'Umsätze warten'} auf Zuweisung</small>}
            </span>
          </button>
          <button className="btn btn--primary" onClick={() => onNavigate?.('buchungen')}>
            <Icon name="plus" size={17} /> Neue Buchung
          </button>
        </div>
      </header>

      <section className="stats" aria-label="Kennzahlen des Kassenjahres">
        <div className="stat stat--hero">
          <div className="stat__top"><span className="stat__label">Kassenstand</span><Icon name="wallet" size={19} /></div>
          <div className="stat__value">{formatEur(totals.closingBalance)}</div>
          <div className="stat__foot">Anfangssaldo {formatEur(file.openingBalance)}</div>
        </div>
        <button type="button" className="stat stat--link" aria-label="Einnahmen: Buchungen anzeigen" aria-describedby="overview-income-total"
          onClick={() => onNavigate?.('buchungen', { type: 'einnahme' })}>
          <span className="stat__top"><span className="stat__label">Einnahmen</span><Icon name="income" size={19} /></span>
          <span className="stat__value amount--in" id="overview-income-total">{formatEur(totals.einnahmen)}</span>
          <span className="stat__foot">Alle Einnahmen <Icon name="arrow" size={13} /></span>
        </button>
        <button type="button" className="stat stat--link" aria-label="Ausgaben: Buchungen anzeigen" aria-describedby="overview-expense-total"
          onClick={() => onNavigate?.('buchungen', { type: 'ausgabe' })}>
          <span className="stat__top"><span className="stat__label">Ausgaben</span><Icon name="expense" size={19} /></span>
          <span className="stat__value amount--out" id="overview-expense-total">{formatEur(totals.ausgaben)}</span>
          <span className="stat__foot">Alle Ausgaben <Icon name="arrow" size={13} /></span>
        </button>
        <button type="button" className="stat stat--link" aria-label="Umsatz: Buchungen anzeigen" aria-describedby="overview-turnover-total"
          onClick={() => onNavigate?.('buchungen', { umsatzOnly: true })}>
          <span className="stat__top"><span className="stat__label">Umsatz</span><Icon name="turnover" size={19} /></span>
          <span className="stat__value" id="overview-turnover-total">{formatEur(totals.umsatz)}</span>
          <span className="stat__foot">Umsatzwirksame Buchungen <Icon name="arrow" size={13} /></span>
        </button>
      </section>

      <div className="overview-grid">
        <section className="card cashflow-card" aria-labelledby="cashflow-heading">
          <div className="section-heading">
            <div><h2 id="cashflow-heading">Einnahmen &amp; Ausgaben</h2><span className="section-heading__detail">Monatsvergleich · {fiscalLabel(file)}</span></div>
            <div className="chart-legend"><span><i className="legend-dot" />Einnahmen</span><span><i className="legend-dot legend-dot--expense" />Ausgaben</span></div>
          </div>
          <div className="table-scroll"><CashflowChart months={months} /></div>
          <p className="hint" style={{ margin: '10px 0 0' }}>Alle Beträge und Monatsdetails findest du in der Monatsübersicht.</p>
        </section>
        <section className="card activity-card" aria-labelledby="recent-heading">
          <div className="section-heading"><h2 id="recent-heading">Zuletzt gebucht</h2>
            <button className="btn btn--ghost btn--sm" onClick={() => onNavigate?.('buchungen', {})}>Alle anzeigen <Icon name="arrow" size={14} /></button>
          </div>
          <div className="activity-list">
            {recent.map((booking) => <button key={booking.id} className="activity-row" onClick={() => onOpenBooking?.(booking.id)}>
              <span className={`activity-row__icon ${booking.type === 'einnahme' ? 'is-income' : 'is-expense'}`}><Icon name={booking.type === 'einnahme' ? 'income' : 'expense'} size={16} /></span>
              <span className="activity-row__body"><strong>{booking.description}</strong><span className="activity-row__meta">{formatDate(booking.date)} · {booking.ref}</span></span>
              <span className="activity-row__amount"><Amount cents={booking.signedAmount} withSign currency /></span>
            </button>)}
            {recent.length === 0 && <div className="empty"><h3>Platz für dein Vereinsjahr</h3><p>Erfasse deine erste Buchung oder importiere einen Kontoauszug.</p></div>}
          </div>
        </section>
      </div>
      <div className="overview-tables">
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
                <tr key={`${m.year}-${m.month}`} className="ledger-row-link"
                  onClick={() => onNavigate?.('buchungen', calendarMonthFilters(m.year, m.month))}>
                  <td>
                    <button type="button" className="ledger-link" aria-label={`Buchungen für ${MONTH_NAMES[m.month - 1]} ${m.year} anzeigen`}
                      onClick={(event) => {
                        event.stopPropagation()
                        onNavigate?.('buchungen', calendarMonthFilters(m.year, m.month))
                      }}>
                      {MONTH_NAMES[m.month - 1]}
                      {(file.fiscalStartMonth ?? 1) !== 1 && <span className="hint"> {m.year}</span>}
                    </button>
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
                <tr key={g.category.id} className="ledger-row-link" onClick={() => onNavigate?.('buchungen', { categoryId: g.category.id })}>
                  <td>
                    <button type="button" className="ledger-link" aria-label={`Buchungen für ${g.category.name} anzeigen`}
                      onClick={(event) => {
                        event.stopPropagation()
                        onNavigate?.('buchungen', { categoryId: g.category.id })
                      }}>{g.category.name}</button>
                  </td>
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
    </div>
  )
}
