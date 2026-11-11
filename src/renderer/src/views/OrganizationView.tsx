import { useMemo, type ReactNode } from 'react'
import { AREA_DEFINITIONS, buildOrganizationReport } from '@shared/organization'
import type { OrganizationPeriod } from '@shared/organization'
import { formatDate, formatEur } from '@shared/money'
import { useStore } from '../store'
import { Amount } from '../components/Amount'
import { Icon } from '../components/Icon'

interface Props {
  onOpenAccount(konto: string): void
  onNavigate(view: 'bereiche' | 'berichte'): void
  period: OrganizationPeriod
  onPeriodChange(period: OrganizationPeriod): void
  yearEndNotice?: ReactNode
}

export function OrganizationView({ onOpenAccount, onNavigate, period, onPeriodChange, yearEndNotice }: Props) {
  const { allFiles, organization } = useStore()
  const report = useMemo(() => buildOrganizationReport(allFiles, organization, period, { carryForwardBalances: true }), [allFiles, organization, period])
  const closingBalance = Number(report.accounts.reduce((sum, account) => sum + BigInt(account.closingBalance ?? 0), 0n))
  const balanceComplete = Number.isSafeInteger(closingBalance) && report.accounts.every((account) => account.closingBalance !== null)
  const hasCarriedBalance = report.accounts.some((account) => account.balanceCarriedFrom !== undefined)
  const openAmount = report.unassignedIncome + report.unassignedExpenses

  return (
    <div className="view org-view">
      <header className="view__header">
        <h1 className="view__title">Vereinsübersicht</h1>
        <button className="btn btn--primary" onClick={() => onNavigate('berichte')}><Icon name="report" size={17} />Berichte</button>
      </header>
      {yearEndNotice}
      <div className="org-period-bar">
        <label className="field"><span>Von</span><input type="date" value={period.from} max={period.to} onChange={(event) => event.target.value && onPeriodChange({ ...period, from: event.target.value })} /></label>
        <label className="field"><span>Bis</span><input type="date" value={period.to} min={period.from} onChange={(event) => event.target.value && onPeriodChange({ ...period, to: event.target.value })} /></label>
        <span className="hint">{report.accounts.length} {report.accounts.length === 1 ? 'Konto' : 'Konten'}</span>
      </div>
      {report.issues.length > 0 && <div className="org-issues" role="status"><strong>Abgleich erforderlich</strong><ul>{report.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul></div>}
      <section className="stats org-stats" aria-label="Kennzahlen des Vereins">
        <div className="stat stat--hero">
          <div className="stat__top"><span className="stat__label">Gesamter Geldbestand</span><Icon name="wallet" size={19} /></div>
          <div className="stat__value">{balanceComplete ? formatEur(closingBalance) : '—'}</div>
          <div className="stat__foot">{formatDate(period.to)}{balanceComplete && hasCarriedBalance ? ' · mit fortgeführtem Stand' : ''}</div>
        </div>
        <div className="stat"><div className="stat__top"><span className="stat__label">Einnahmen</span><Icon name="income" size={19} /></div><div className="stat__value amount--in">{formatEur(report.income)}</div></div>
        <div className="stat"><div className="stat__top"><span className="stat__label">Ausgaben</span><Icon name="expense" size={19} /></div><div className="stat__value amount--out">{formatEur(report.expenses)}</div></div>
        <div className="stat"><div className="stat__top"><span className="stat__label">Ergebnis</span><Icon name="report" size={19} /></div><div className="stat__value"><Amount cents={report.result} currency /></div></div>
      </section>
      <section aria-labelledby="org-accounts-title">
        <div className="section-heading"><h2 id="org-accounts-title">Konten &amp; Kassen</h2></div>
        <div className="org-account-grid">
          {report.accounts.map((account) => <button className="card org-account-card" key={account.konto} onClick={() => onOpenAccount(account.konto)}>
            <span className="org-account-card__name"><Icon name="book" size={19} /><strong>{account.name}</strong></span>
            <span className="org-account-card__balance">
              {account.closingBalance === null ? 'Bestand offen' : formatEur(account.closingBalance)}
              {account.balanceCarriedFrom && <small className="org-account-card__basis">Stand vom {formatDate(account.balanceCarriedFrom)}</small>}
            </span>
            <Icon name="arrow" size={17} />
          </button>)}
          {report.accounts.length === 0 && <div className="card empty"><h3>Keine Konten im Zeitraum</h3></div>}
        </div>
      </section>
      <div className="org-overview-grid">
        <section className="card">
          <div className="card__heading"><h2 className="card__title">Tätigkeitsbereiche</h2><button className="btn btn--ghost btn--sm" onClick={() => onNavigate('bereiche')}>Zuordnung <Icon name="arrow" size={14} /></button></div>
          <div className="table-scroll"><table className="ledger"><thead><tr><th>Bereich</th><th className="num">Einnahmen</th><th className="num">Ausgaben</th><th className="num">Ergebnis</th></tr></thead><tbody>
            {report.areas.map((area) => <tr key={area.area}><td><span className={`org-area-mark org-area-mark--${area.area}`}>{area.area}</span>{AREA_DEFINITIONS.find((entry) => entry.id === area.area)?.name}</td><td className="num">{formatEur(area.income)}</td><td className="num">{formatEur(area.expenses)}</td><td className="num"><Amount cents={area.result} currency /></td></tr>)}
            {report.openCount > 0 && <tr className="org-unassigned-row"><td>Noch zuzuordnen</td><td className="num">{formatEur(report.unassignedIncome)}</td><td className="num">{formatEur(report.unassignedExpenses)}</td><td className="num">{formatEur(report.unassignedIncome - report.unassignedExpenses)}</td></tr>}
            <tr className="total-row"><td>Gesamt</td><td className="num">{formatEur(report.income)}</td><td className="num">{formatEur(report.expenses)}</td><td className="num">{formatEur(report.result)}</td></tr>
          </tbody></table></div>
          <div className="org-card-footer"><Icon name="turnover" size={15} /><span>{report.transferCount} Umbuchungen · {formatEur(report.transferVolume)}</span></div>
        </section>
        <section className="card org-open-card">
          <h2 className="card__title">Zuordnung</h2>
          <strong className="org-open-count">{report.openCount}</strong>
          <p>{report.openCount === 1 ? 'Buchung offen' : 'Buchungen offen'}</p>
          <div className="hint">{formatEur(openAmount)}</div>
          <button className="btn btn--primary" onClick={() => onNavigate(report.openCount ? 'bereiche' : 'berichte')}>{report.openCount ? 'Zuordnen' : 'Berichte öffnen'}<Icon name="arrow" size={15} /></button>
        </section>
      </div>
    </div>
  )
}
