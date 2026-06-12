import { useStore } from '../store'
import { Amount } from '../components/Amount'
import { fiscalLabel } from '@shared/fiscal'
import { byCategory, eventRows } from '@shared/ledger'
import { formatDate } from '@shared/money'

/** Buchungen nach Veranstaltung gruppiert mit Zwischensummen – wie das Excel-Blatt. */
export function VeranstaltungenView() {
  const { file } = useStore()
  if (!file) return null
  const groups = byCategory(file)

  return (
    <div className="view">
      <header className="view__header">
        <div>
          <h1 className="view__title">Veranstaltungen {fiscalLabel(file)}</h1>
          <p className="view__subtitle">Buchungen nach Veranstaltung sortiert, mit Saldo je Veranstaltung.</p>
        </div>
      </header>

      <section className="card">
        {groups.length === 0 ? (
          <div className="empty">
            <h3>Noch keine Buchungen</h3>
          </div>
        ) : (
          <table className="ledger">
            <thead>
              <tr>
                <th>Nr.</th>
                <th>Datum</th>
                <th>Verwendungszweck</th>
                <th className="num">Ausgaben (€)</th>
                <th className="num">Einnahmen (€)</th>
                <th className="num">Saldo (€)</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <GroupRows key={g.category.id} group={g} />
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}

function GroupRows({ group }: { group: ReturnType<typeof byCategory>[number] }) {
  return (
    <>
      <tr className="group-head">
        <td colSpan={6}>{group.category.name}</td>
      </tr>
      {eventRows(group).map((r) => (
        <tr key={`${r.refs}-${r.label}`}>
          <td className="ref">{r.refs}</td>
          <td style={{ whiteSpace: 'nowrap' }}>{r.kind === 'einzeln' ? formatDate(r.date) : ''}</td>
          <td className="cell-desc">
            {r.label}
            {r.kind === 'unterkategorie' && (
              <span className="pill" style={{ marginLeft: 6 }}>{r.count} Buchungen</span>
            )}
          </td>
          <td className="num">{r.ausgaben > 0 ? <Amount cents={-r.ausgaben} /> : ''}</td>
          <td className="num">{r.einnahmen > 0 ? <Amount cents={r.einnahmen} /> : ''}</td>
          <td></td>
        </tr>
      ))}
      <tr className="group-sum">
        <td colSpan={3}>Saldo {group.category.name}</td>
        <td className="num"><Amount cents={-group.ausgaben} /></td>
        <td className="num"><Amount cents={group.einnahmen} /></td>
        <td className="num"><Amount cents={group.saldo} withSign /></td>
      </tr>
    </>
  )
}
