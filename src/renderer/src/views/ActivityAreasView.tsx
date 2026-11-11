import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AREA_DEFINITIONS,
  allOrganizationBookings,
  allocationError,
  bookingKey,
  buildOrganizationReport,
} from '@shared/organization'
import type {
  ActivityAllocation,
  ActivityAreaId,
  BookingReference,
  OrganizationBooking,
  OrganizationPeriod,
} from '@shared/organization'
import { formatDate, formatEur } from '@shared/money'
import { fiscalLabel } from '@shared/fiscal'
import { useStore } from '../store'
import { ActivityAllocationEditor } from '../components/ActivityAllocationEditor'
import { Amount } from '../components/Amount'
import { Icon } from '../components/Icon'
import { ActivityCategoryAssignments } from './ActivityCategoryAssignments'
import '../styles/activityAreas.css'

interface Props {
  period: OrganizationPeriod
  onOpenBooking?(reference: BookingReference): void
}

type Tab = 'open' | 'all' | 'rules' | 'transfers'
const areaName = (id: ActivityAreaId) => AREA_DEFINITIONS.find((area) => area.id === id)?.name ?? id

export function ActivityAreasView({ period, onOpenBooking }: Props) {
  const { allFiles, organization } = useStore()
  const report = useMemo(() => buildOrganizationReport(allFiles, organization, period), [allFiles, organization, period])
  const [tab, setTab] = useState<Tab>('rules')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<OrganizationBooking | null>(null)
  const available = report.bookings.filter((entry) => !entry.transferId && (tab === 'all' || entry.status !== 'assigned'))
  const normalizedQuery = query.toLocaleLowerCase('de-DE').trim()
  const visible = available.filter((entry) => !normalizedQuery || [entry.booking.description, entry.booking.name, entry.booking.categoryName, entry.kontoName, entry.booking.ref].join(' ').toLocaleLowerCase('de-DE').includes(normalizedQuery))

  return (
    <div className="view org-view org-areas-view">
      <header className="view__header"><div><h1 className="view__title">Tätigkeitsbereiche</h1><p className="view__subtitle">{formatDate(period.from)} – {formatDate(period.to)}</p></div></header>
      <section className="org-area-grid" aria-label="Ergebnis nach Tätigkeitsbereich">
        {report.areas.map((area) => <div className="card org-area-card" key={area.area}><span className={`org-area-mark org-area-mark--${area.area}`}>{area.area}</span><h2>{areaName(area.area)}</h2><div className="org-area-card__amount"><Amount cents={area.result} currency /></div></div>)}
      </section>
      <div className="org-tabs" role="tablist" aria-label="Bereichszuordnung">
        {([
          ['rules', 'Kategorien zuordnen'],
          ['open', 'Buchungen prüfen'],
          ['all', 'Alle Buchungen'],
          ['transfers', 'Umbuchungen'],
        ] as const).map(([id, title]) => <button type="button" key={id} id={`org-tab-${id}`} className={`org-tab${tab === id ? ' is-active' : ''}`} role="tab" aria-selected={tab === id} aria-controls={`org-panel-${id}`} tabIndex={tab === id ? 0 : -1}
          onClick={() => setTab(id)} onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
            event.preventDefault()
            const ids: Tab[] = ['rules', 'open', 'all', 'transfers']
            const index = ids.indexOf(tab)
            const next = event.key === 'Home' ? ids[0] : event.key === 'End' ? ids[3] : ids[(index + (event.key === 'ArrowRight' ? 1 : 3)) % 4]
            setTab(next)
            document.getElementById(`org-tab-${next}`)?.focus()
          }}>{title}{id === 'open' && <span className="pill">{report.openCount}</span>}</button>)}
      </div>
      <section id={`org-panel-${tab}`} role="tabpanel" aria-labelledby={`org-tab-${tab}`}>
        {tab === 'rules' ? <ActivityCategoryAssignments /> : tab === 'transfers' ? <Transfers onOpenBooking={onOpenBooking} /> : <>
          <div className="org-filter-bar"><label className="field"><span className="org-sr-only">Buchungen filtern</span><input type="search" aria-label="Buchungen filtern" placeholder="Buchungen filtern" value={query} onChange={(event) => setQuery(event.target.value)} /></label><span className="hint">{visible.length} {visible.length === 1 ? 'Buchung' : 'Buchungen'}</span></div>
          {report.issues.length > 0 && <div className="org-issues" role="status"><strong>Abgleich erforderlich</strong><ul>{report.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul></div>}
          <div className="card org-booking-table"><div className="table-scroll"><table className="ledger"><thead><tr><th>Buchung</th><th>Konto</th><th className="num">Betrag</th><th>Zuordnung</th><th><span className="org-sr-only">Aktion</span></th></tr></thead><tbody>
            {visible.map((entry) => <tr key={entry.key}><td><BookingTitle entry={entry} onOpenBooking={onOpenBooking} /><div className="hint">{formatDate(entry.booking.date)} · {entry.booking.ref} · {entry.booking.categoryName}</div></td><td>{entry.kontoName}<div className="hint">{fiscalLabel(entry.file)}</div></td><td className="num"><Amount cents={entry.booking.signedAmount} currency withSign /></td><td><AssignmentStatus entry={entry} /></td><td className="num"><button className={`btn btn--sm${entry.status === 'assigned' ? '' : ' btn--primary'}`} onClick={() => setEditing(entry)}>{entry.status === 'assigned' ? 'Bearbeiten' : 'Zuordnen'}</button></td></tr>)}
          </tbody></table></div>
          {visible.length === 0 && <div className="empty"><h3>{normalizedQuery ? 'Keine Treffer' : tab === 'open' ? 'Keine offenen Zuordnungen' : 'Keine Buchungen'}</h3></div>}
          </div>
        </>}
      </section>
      {editing && <AssignmentDialog key={editing.key} entry={editing} onClose={() => setEditing(null)} onOpenBooking={onOpenBooking} />}
    </div>
  )
}

function BookingTitle({ entry, onOpenBooking }: { entry: OrganizationBooking; onOpenBooking?: Props['onOpenBooking'] }) {
  return onOpenBooking ? <button className="ledger-link" onClick={() => onOpenBooking(entry.reference)}>{entry.booking.description}</button> : <strong>{entry.booking.description}</strong>
}

function AssignmentStatus({ entry }: { entry: OrganizationBooking }) {
  if (entry.status === 'invalid') return <span className="org-status org-status--warn">Erneut prüfen</span>
  if (entry.status !== 'assigned') return <div><span className="org-status org-status--warn">Offen</span>{entry.suggestedArea && <div className="hint">Vorschlag: {areaName(entry.suggestedArea)}</div>}</div>
  return <div className="org-assignment-tags">{entry.allocations.map((part) => <span key={part.area} className="org-status" title={areaName(part.area)}>{part.area}{entry.allocations.length > 1 ? ` · ${formatEur(part.amount)}` : ` · ${areaName(part.area)}`}</span>)}</div>
}

function AssignmentDialog({ entry, onClose, onOpenBooking }: { entry: OrganizationBooking; onClose(): void; onOpenBooking?: Props['onOpenBooking'] }) {
  const { setAllocations } = useStore()
  const [allocations, setDraft] = useState<ActivityAllocation[]>(entry.allocations.map((part) => ({ ...part })))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)
  const valid = allocations.length > 0 && !allocationError(entry.booking.amount, allocations)

  useEffect(() => {
    const previous = document.activeElement
    panelRef.current?.focus()
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
      else document.getElementById('org-tab-open')?.focus()
    }
  }, [])

  async function save(value: ActivityAllocation[]) {
    setBusy(true)
    setError('')
    try {
      await setAllocations(entry.reference, value)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Die Zuordnung konnte nicht gespeichert werden.')
      setBusy(false)
    }
  }

  return <div className="modal-overlay org-modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <div className="modal-panel org-assignment-dialog" role="dialog" aria-modal="true" aria-labelledby="org-assignment-title" ref={panelRef} tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) { event.preventDefault(); onClose() }
        if (event.key !== 'Tab') return
        const controls = panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]')
        if (!controls?.length) { event.preventDefault(); return }
        const first = controls[0], last = controls[controls.length - 1]
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }}>
      <form onSubmit={(event) => { event.preventDefault(); if (valid && !busy) void save(allocations) }}>
        <div className="card__heading"><h2 id="org-assignment-title">Buchung zuordnen</h2><button type="button" className="icon-button" aria-label="Zuordnung schließen" onClick={onClose} disabled={busy}><Icon name="close" /></button></div>
        <div className="org-assignment-summary"><strong>{entry.booking.description}</strong><div className="org-assignment-summary__amount"><Amount cents={entry.booking.signedAmount} currency withSign /></div><span className="hint">{entry.kontoName} · {formatDate(entry.booking.date)} · {entry.booking.ref}</span></div>
        <ActivityAllocationEditor amount={entry.booking.amount} value={allocations} onChange={setDraft} suggestedArea={entry.suggestedArea} disabled={busy} />
        {error && <p className="org-error" role="alert">{error}</p>}
        <div className="org-modal-actions">
          {entry.status !== 'open' && <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => void save([])}>Zuordnung entfernen</button>}
          {onOpenBooking && <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => { onClose(); onOpenBooking(entry.reference) }}>Buchung öffnen</button>}
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Abbrechen</button><button type="submit" className="btn btn--primary" disabled={busy || !valid}>{busy ? 'Speichert …' : 'Speichern'}</button>
        </div>
      </form>
    </div>
  </div>
}

function Transfers({ onOpenBooking }: { onOpenBooking?: Props['onOpenBooking'] }) {
  const { allFiles, organization, linkTransfer, unlinkTransfer, kontos } = useStore()
  const entries = useMemo(() => allOrganizationBookings(allFiles, organization), [allFiles, organization])
  const [fromKey, setFromKey] = useState('')
  const [toKey, setToKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const available = entries.filter((entry) => !entry.transferId && entry.booking.amount > 0)
  const outgoing = available.filter((entry) => entry.booking.type === 'ausgabe')
  const source = outgoing.find((entry) => entry.key === fromKey)
  const incoming = source ? available.filter((entry) => entry.booking.type === 'einnahme' && entry.reference.konto !== source.reference.konto && entry.booking.amount === source.booking.amount) : []
  const target = incoming.find((entry) => entry.key === toKey)
  const names = (reference: BookingReference) => kontos.find((entry) => entry.id === reference.konto)?.name ?? reference.konto

  async function link() {
    if (!source || !target) return
    setBusy(true)
    setError('')
    try {
      await linkTransfer(source.reference, target.reference)
      setFromKey('')
      setToKey('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Die Umbuchung konnte nicht gespeichert werden.') } finally { setBusy(false) }
  }

  async function unlink(id: string) {
    setBusy(true)
    setError('')
    try { await unlinkTransfer(id) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Die Verknüpfung konnte nicht entfernt werden.') } finally { setBusy(false) }
  }

  function movementLabel(entry: OrganizationBooking) {
    return `${formatDate(entry.booking.date)} · ${entry.kontoName} · ${entry.booking.ref} · ${entry.booking.description} · ${formatEur(entry.booking.amount)}`
  }

  return <div className="org-transfers">
    <section className="card">
      <h2 className="card__title">Umbuchung verknüpfen</h2>
      <form className="org-transfer-form" onSubmit={(event) => { event.preventDefault(); if (!busy) void link() }}>
        <label className="field"><span>Abgang</span><select aria-label="Abgang der Umbuchung" value={source?.key ?? ''} onChange={(event) => { setFromKey(event.target.value); setToKey('') }} disabled={busy} required><option value="">Ausgabe wählen</option>{outgoing.map((entry) => <option key={entry.key} value={entry.key}>{movementLabel(entry)}</option>)}</select></label>
        <label className="field"><span>Zugang</span><select aria-label="Zugang der Umbuchung" value={target?.key ?? ''} onChange={(event) => setToKey(event.target.value)} disabled={busy || !source} required><option value="">{source && incoming.length === 0 ? 'Keine passende Gegenbuchung' : 'Einnahme wählen'}</option>{incoming.map((entry) => <option key={entry.key} value={entry.key}>{movementLabel(entry)}</option>)}</select></label>
        <button className="btn btn--primary" type="submit" disabled={busy || !source || !target}>Verknüpfen</button>
      </form>
      <p className="hint">Beide Kontobewegungen bleiben erhalten. Die Verknüpfung wird im Vereinsbericht neutralisiert.</p>
      {error && <p className="org-error" role="alert">{error}</p>}
    </section>
    <section className="card">
      <h2 className="card__title">Verknüpfte Umbuchungen</h2>
      {organization.transfers.length === 0 && <div className="empty"><h3>Keine Umbuchungen verknüpft</h3></div>}
      {organization.transfers.map((transfer) => {
        const from = entries.find((entry) => entry.key === bookingKey(transfer.from))
        const to = entries.find((entry) => entry.key === bookingKey(transfer.to))
        const valid = from?.transferId === transfer.id && to?.transferId === transfer.id
        return <div className="org-transfer-pair" key={transfer.id}>
          <div className="org-transfer-movements"><div><strong>{names(transfer.from)}</strong><div className="hint">{formatDate(transfer.fromDate)} · Abgang</div><div className="org-transfer-amount">−{formatEur(transfer.amount)}</div>{from ? <BookingTitle entry={from} onOpenBooking={onOpenBooking} /> : <span className="org-error">Buchung fehlt</span>}</div><Icon name="arrow" size={21} /><div><strong>{names(transfer.to)}</strong><div className="hint">{formatDate(transfer.toDate)} · Zugang</div><div className="org-transfer-amount amount--in">+{formatEur(transfer.amount)}</div>{to ? <BookingTitle entry={to} onOpenBooking={onOpenBooking} /> : <span className="org-error">Buchung fehlt</span>}</div></div>
          <div className="org-transfer-actions"><span className={`org-status${valid ? '' : ' org-status--warn'}`}>{valid ? 'Verknüpft' : 'Erneut prüfen'}</span><button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void unlink(transfer.id)}>Verknüpfung entfernen</button></div>
        </div>
      })}
    </section>
  </div>
}
