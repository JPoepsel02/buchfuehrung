import { useEffect, useMemo, useRef, useState } from 'react'
import { AREA_DEFINITIONS, categoryAllocations, categoryDefaultCandidates } from '@shared/organization'
import type { ActivityAreaId, BookingReference, OrganizationBooking, OrganizationConfig } from '@shared/organization'
import { formatDate, formatEur } from '@shared/money'
import { useStore } from '../store'
import { Amount } from '../components/Amount'
import { Icon } from '../components/Icon'

interface CategoryRow {
  key: string
  konto: string
  categoryId: string
  name: string
  code?: string
  accountName: string
  inactive: boolean
  missing: boolean
  area?: ActivityAreaId
}

const categoryKey = (konto: string, categoryId: string) => JSON.stringify([konto, categoryId])

export function ActivityCategoryAssignments() {
  const { allFiles, organization, kontos, setCategoryArea } = useStore()
  const [konto, setKonto] = useState('')
  const [filter, setFilter] = useState<'all' | 'unassigned'>('all')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [previewOpen, setPreviewOpen] = useState(false)
  const rows = useMemo(() => {
    const categories = new Map<string, CategoryRow>()
    const rules = new Map(organization.rules.map((rule) => [categoryKey(rule.konto, rule.categoryId), rule]))
    const accountNames = new Map(kontos.map((entry) => [entry.id, entry.name]))
    for (const file of [...allFiles].sort((left, right) => right.year - left.year)) {
      const account = file.konto ?? 'haupt'
      if (!accountNames.has(account)) accountNames.set(account, file.kontoName || account)
      for (const category of file.categories) {
        const key = categoryKey(account, category.id)
        if (categories.has(key)) continue
        categories.set(key, { key, konto: account, categoryId: category.id, name: category.name, code: category.code?.trim(),
          accountName: accountNames.get(account) || account, inactive: !category.active,
          missing: false, area: rules.get(key)?.area })
      }
    }
    for (const rule of organization.rules) {
      const key = categoryKey(rule.konto, rule.categoryId)
      if (!categories.has(key)) categories.set(key, {
        key, konto: rule.konto, categoryId: rule.categoryId, name: 'Nicht mehr vorhandene Kategorie',
        accountName: accountNames.get(rule.konto) || rule.konto, inactive: true, missing: true, area: rule.area,
      })
    }
    return [...categories.values()].sort((left, right) => left.name.localeCompare(right.name, 'de')
      || left.accountName.localeCompare(right.accountName, 'de'))
  }, [allFiles, organization.rules, kontos])
  const accountOptions = useMemo(() => {
    const values = new Map(kontos.map((entry) => [entry.id, entry.name]))
    for (const row of rows) if (!values.has(row.konto)) values.set(row.konto, row.accountName)
    return [...values].map(([id, name]) => ({ id, name }))
  }, [kontos, rows])
  const visible = rows.filter((row) => (!konto || row.konto === konto) && (filter === 'all' || !row.area))
  const candidates = useMemo(() => categoryDefaultCandidates(allFiles, organization)
    .filter((entry) => !konto || entry.reference.konto === konto), [allFiles, organization, konto])

  async function changeArea(row: CategoryRow, area: string) {
    if (busy || area === (row.area ?? '')) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await setCategoryArea(row.konto, row.categoryId, area ? area as ActivityAreaId : undefined)
      setMessage('Zuordnung gespeichert.')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Die Kategorie konnte nicht zugeordnet werden.')
    } finally { setBusy(false) }
  }

  return <div className="activity-categories">
    <div className="activity-category-toolbar">
      <div className="activity-category-filters">
        <label className="field"><span>Konto</span><select aria-label="Kategorien nach Konto filtern" value={konto} onChange={(event) => setKonto(event.target.value)} disabled={busy}>
          <option value="">Alle Konten</option>{accountOptions.map((entry) => <option value={entry.id} key={entry.id}>{entry.name}</option>)}
        </select></label>
        <label className="field"><span>Zuordnung</span><select aria-label="Kategorien nach Zuordnung filtern" value={filter} onChange={(event) => setFilter(event.target.value as 'all' | 'unassigned')} disabled={busy}>
          <option value="all">Alle</option><option value="unassigned">Ohne Zuordnung</option>
        </select></label>
      </div>
      <button type="button" className="btn" disabled={busy || candidates.length === 0} onClick={() => { setMessage(''); setPreviewOpen(true) }}>Bestehende Buchungen zuordnen</button>
    </div>
    <div className="activity-category-status"><p className="hint">Gilt für neue Buchungen. Bestehende Buchungen werden erst nach Bestätigung zugeordnet.</p><span className="hint">{visible.length} {visible.length === 1 ? 'Kategorie' : 'Kategorien'}</span></div>
    {error && <p className="org-error" role="alert">{error}</p>}
    {message && <p className="activity-category-message" role="status">{message}</p>}
    <section className="card activity-category-card" id="activity-category-list" tabIndex={-1} aria-label="Kategorien aller Kassenjahre">
      <div className="table-scroll"><table className="ledger activity-category-table"><thead><tr><th>Kategorie</th><th>Konto</th><th>Tätigkeitsbereich</th></tr></thead><tbody>
        {visible.map((row) => <tr key={row.key} data-category-key={row.key}><td><strong>{row.name}</strong>{row.missing ? <div className="hint">{row.categoryId}</div> : row.code || row.inactive ? <div className="hint">{row.code ? `Kürzel: ${row.code}` : ''}{row.code && row.inactive ? ' · ' : ''}{row.inactive ? 'Inaktiv' : ''}</div> : null}</td><td>{row.accountName}</td><td><select aria-label={`Tätigkeitsbereich für ${row.name} (${row.accountName})`} value={row.area ?? ''} disabled={busy}
          onChange={(event) => void changeArea(row, event.target.value)}>
          <option value="">Bereich wählen</option>{AREA_DEFINITIONS.map((area) => <option value={area.id} key={area.id} disabled={row.missing && row.area !== area.id}>{area.name}</option>)}
        </select></td></tr>)}
      </tbody></table></div>
      {visible.length === 0 && <div className="empty"><h3>{filter === 'unassigned' ? 'Alle Kategorien sind zugeordnet' : 'Keine Kategorien'}</h3></div>}
    </section>
    {previewOpen && <CategoryDefaultsPreview entries={candidates} organization={organization} scope={accountOptions.find((entry) => entry.id === konto)?.name ?? 'Alle Konten'} onClose={() => setPreviewOpen(false)} onApplied={(count) => { setPreviewOpen(false); setMessage(`${count} ${count === 1 ? 'Buchung zugeordnet.' : 'Buchungen zugeordnet.'}`) }} />}
  </div>
}

function CategoryDefaultsPreview({ entries, organization, scope, onClose, onApplied }: {
  entries: OrganizationBooking[]
  organization: OrganizationConfig
  scope: string
  onClose(): void
  onApplied(count: number): void
}) {
  const { applyCategoryDefaults } = useStore()
  const [selected, setSelected] = useState(() => new Set(entries.map((entry) => entry.key)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)
  const selectAllRef = useRef<HTMLInputElement>(null)
  const chosen = entries.filter((entry) => selected.has(entry.key))
  const allSelected = entries.length > 0 && chosen.length === entries.length

  useEffect(() => {
    const previous = document.activeElement
    panelRef.current?.focus()
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected && !(previous instanceof HTMLButtonElement && previous.disabled)) previous.focus()
      else document.getElementById('activity-category-list')?.focus({ preventScroll: true })
    }
  }, [])
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = chosen.length > 0 && !allSelected
  }, [chosen.length, allSelected])

  function toggle(reference: string, checked: boolean) {
    setSelected((current) => checked ? new Set([...current, reference]) : new Set([...current].filter((key) => key !== reference)))
  }
  async function apply() {
    if (!chosen.length || busy) return
    setBusy(true)
    setError('')
    const references: BookingReference[] = chosen.map((entry) => ({ ...entry.reference }))
    try {
      await applyCategoryDefaults(references)
      onApplied(references.length)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Die Zuordnungen konnten nicht gespeichert werden.')
      setBusy(false)
    }
  }

  return <div className="modal-overlay activity-category-preview-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <div className="modal-panel activity-category-preview" role="dialog" aria-modal="true" aria-labelledby="activity-category-preview-title" aria-describedby="activity-category-preview-description" tabIndex={-1} ref={panelRef}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!busy) onClose() }
        if (event.key !== 'Tab') return
        const controls = panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]')
        if (!controls?.length) { event.preventDefault(); return }
        const first = controls[0], last = controls[controls.length - 1]
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }}>
      <div className="card__heading"><h2 id="activity-category-preview-title">Bestehende Buchungen zuordnen</h2><button type="button" className="icon-button" aria-label="Vorschau schließen" disabled={busy} onClick={onClose}><Icon name="close" /></button></div>
      <p className="hint" id="activity-category-preview-description">{scope} · alle Kassenjahre. Bereits zugeordnete Buchungen bleiben erhalten.</p>
      <div className="activity-preview-count" role="status">{chosen.length} von {entries.length} {entries.length === 1 ? 'Buchung ausgewählt' : 'Buchungen ausgewählt'}</div>
      <div className="table-scroll activity-preview-table"><table className="ledger"><thead><tr><th><input ref={selectAllRef} type="checkbox" aria-label="Alle vorgeschlagenen Buchungen auswählen" disabled={busy || entries.length === 0} checked={allSelected} onChange={(event) => setSelected(event.target.checked ? new Set(entries.map((entry) => entry.key)) : new Set())} /></th><th>Buchung</th><th>Konto</th><th>Kategorie</th><th className="num">Betrag</th><th>Tätigkeitsbereich</th></tr></thead><tbody>
        {entries.map((entry) => <tr key={entry.key} data-booking-key={entry.key}><td><input type="checkbox" aria-label={`Buchung ${entry.booking.ref} (${entry.kontoName}, ${formatDate(entry.booking.date)}) auswählen`} disabled={busy} checked={selected.has(entry.key)} onChange={(event) => toggle(entry.key, event.target.checked)} /></td><td><strong>{entry.booking.description}</strong><div className="hint">{formatDate(entry.booking.date)} · {entry.booking.ref}</div></td><td>{entry.kontoName}</td><td>{entry.booking.categoryName}</td><td className="num"><Amount cents={entry.booking.signedAmount} currency withSign /></td><td>{categoryAllocations(organization, entry.reference.konto, entry.booking.categoryId, entry.booking.amount).map((part) => <span key={part.area}>{AREA_DEFINITIONS.find((area) => area.id === part.area)?.name ?? part.area}{entry.allocations.length > 1 ? ` · ${formatEur(part.amount)}` : ''}</span>)}</td></tr>)}
      </tbody></table></div>
      {entries.length === 0 && <div className="empty"><h3>Keine Buchungen für die Übernahme</h3></div>}
      {error && <p className="org-error" role="alert">{error}</p>}
      <div className="org-modal-actions"><button type="button" className="btn" disabled={busy} onClick={onClose}>Abbrechen</button><button type="button" className="btn btn--primary" disabled={busy || chosen.length === 0} onClick={() => void apply()}>{busy ? 'Speichert …' : 'Zuordnung übernehmen'}</button></div>
    </div>
  </div>
}
