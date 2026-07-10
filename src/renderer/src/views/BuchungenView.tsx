import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { Amount } from '../components/Amount'
import { AmountField } from '../components/AmountInput'
import { shouldStartBookingEdit } from '../bookingRow'
import { fiscalRange, inFiscalYear } from '@shared/fiscal'
import { bookingsToCsv } from '@shared/bookingExport'
import { subcategorySuggestions } from '@shared/importDraft'
import { bookingMatches, computeBookings } from '@shared/ledger'
import { formatDate, parseAmountToCents } from '@shared/money'
import { receiptAvailable, receiptStatus, receiptStatusLabel, withReceiptStatus } from '@shared/receipt'
import type { Booking, BookingType, ReceiptStatus } from '@shared/types'

interface FormState {
  date: string
  categoryId: string
  name: string
  description: string
  subcategory: string
  type: BookingType
  amount: string
  isUmsatz: boolean
  receiptStatus: ReceiptStatus
  nonUmsatz: string
  note: string
}

const emptyForm = (categoryId: string, fiscal: { year: number; fiscalStartMonth?: number }): FormState => ({
  // Heute, wenn es im Wirtschaftsjahr liegt – sonst der erste Tag des Wirtschaftsjahres
  date: inFiscalYear(fiscal, new Date().toISOString().slice(0, 10))
    ? new Date().toISOString().slice(0, 10)
    : fiscalRange(fiscal).start,
  categoryId,
  name: '',
  description: '',
  subcategory: '',
  type: 'ausgabe',
  amount: '',
  isUmsatz: false,
  receiptStatus: 'vorhanden',
  nonUmsatz: '',
  note: '',
})

export function BuchungenView({
  externalFilter = '',
  onFilterConsumed,
  bookingToOpenId,
  onBookingOpened,
}: {
  /** Suchbegriff aus der globalen Strg+F-Suche */
  externalFilter?: string
  onFilterConsumed?: () => void
  /** Konkreter Treffer aus der globalen Suche. */
  bookingToOpenId?: string | null
  onBookingOpened?: () => void
}) {
  const { file, addBooking, updateBooking, deleteBooking } = useStore()
  const activeCats = useMemo(
    () => (file ? file.categories.filter((c) => c.active).sort((a, b) => a.sortOrder - b.sortOrder) : []),
    [file],
  )
  const [form, setForm] = useState<FormState>(() => emptyForm(activeCats[0]?.id ?? '', file ?? { year: 2026 }))
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [filter, setFilter] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  // Mehrfachauswahl für die Sammel-Bearbeitung
  const [checkedIds, setCheckedIds] = useState<ReadonlySet<string>>(new Set())
  const [bulk, setBulk] = useState({
    categoryId: '',
    subcategory: '',
    name: '',
    receiptStatus: '' as '' | ReceiptStatus,
    isUmsatz: '' as '' | 'ja' | 'nein',
  })

  // Vorschläge: bereits verwendete Unterkategorien der gewählten Kategorie
  const subSuggestions = useMemo(
    () => subcategorySuggestions(file?.bookings ?? [], form.categoryId),
    [file, form.categoryId],
  )

  // Suchbegriff aus der globalen Strg+F-Suche übernehmen
  useEffect(() => {
    if (externalFilter) {
      setFilter(externalFilter)
      onFilterConsumed?.()
    }
  }, [externalFilter, onFilterConsumed])

  useEffect(() => {
    if (!bookingToOpenId || !file) return
    const booking = file.bookings.find((row) => row.id === bookingToOpenId)
    if (!booking) return
    setFilter('')
    startEdit(booking)
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-booking-id="${bookingToOpenId}"]`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      })
    })
    onBookingOpened?.()
  }, [bookingToOpenId, file])

  if (!file) return null
  const rows = computeBookings(file)
    .sort((a, b) => b.seq - a.seq)
    .filter((r) => bookingMatches(r, filter))

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function startEdit(b: Booking) {
    setEditingId(b.id)
    setForm({
      date: b.date,
      categoryId: b.categoryId,
      name: b.name ?? '',
      description: b.description,
      subcategory: b.subcategory ?? '',
      type: b.type,
      amount: (b.amount / 100).toFixed(2).replace('.', ','),
      isUmsatz: b.isUmsatz,
      receiptStatus: receiptStatus(b),
      nonUmsatz: b.nonUmsatzAmount ? (b.nonUmsatzAmount / 100).toFixed(2).replace('.', ',') : '',
      note: b.note,
    })
    setAdvancedOpen(true)
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const amount = parseAmountToCents(form.amount)
    const nonUmsatz = form.nonUmsatz.trim() ? parseAmountToCents(form.nonUmsatz) : 0
    if (!form.date || !/^\d{4}-\d{2}-\d{2}$/.test(form.date)) return setError('Bitte ein Datum wählen.')
    if (!inFiscalYear(file!, form.date)) return setError('Das Datum liegt außerhalb des aktiven Kassenjahrs.')
    if (!form.categoryId) return setError('Bitte eine Kategorie wählen.')
    if (!form.name.trim()) return setError('Bitte einen Namen angeben.')
    if (!form.description.trim()) return setError('Bitte einen Verwendungszweck angeben.')
    if (amount === null || amount <= 0) return setError('Bitte einen gültigen Betrag größer 0 angeben.')
    if (nonUmsatz === null || nonUmsatz < 0) return setError('„Davon kein Umsatz“ ist kein gültiger Betrag.')
    if (nonUmsatz > amount) return setError('„Davon kein Umsatz“ darf den Betrag nicht übersteigen.')

    const data = withReceiptStatus({
      date: form.date,
      categoryId: form.categoryId,
      name: form.name.trim(),
      description: form.description.trim(),
      subcategory: form.subcategory.trim() || undefined,
      type: form.type,
      amount,
      isUmsatz: form.isUmsatz,
      nonUmsatzAmount: form.isUmsatz ? nonUmsatz : 0,
      note: form.note.trim(),
      source: 'manuell' as const,
    }, form.receiptStatus)
    if (editingId) {
      updateBooking(editingId, data)
      setEditingId(null)
    } else {
      addBooking(data)
    }
    setForm((f) => ({ ...emptyForm(f.categoryId, file!), date: f.date }))
    setAdvancedOpen(false)
  }

  function cancelEdit() {
    setEditingId(null)
    setForm(emptyForm(activeCats[0]?.id ?? '', file!))
    setError('')
    setAdvancedOpen(false)
  }

  function toggleChecked(id: string, checked: boolean) {
    setCheckedIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const visibleChecked = rows.filter((r) => checkedIds.has(r.id))
  const allVisibleChecked = rows.length > 0 && rows.every((r) => checkedIds.has(r.id))

  function toggleAllVisible(checked: boolean) {
    setCheckedIds((prev) => {
      const next = new Set(prev)
      for (const r of rows) {
        if (checked) next.add(r.id)
        else next.delete(r.id)
      }
      return next
    })
  }

  const bulkHasValue =
    Boolean(bulk.categoryId || bulk.subcategory.trim() || bulk.name.trim()) ||
    bulk.receiptStatus !== '' ||
    bulk.isUmsatz !== ''

  /** Wendet die Sammel-Bearbeitung auf alle ausgewählten Buchungen an. */
  function applyBulk() {
    const patch: Partial<Booking> = {}
    if (bulk.categoryId) patch.categoryId = bulk.categoryId
    if (bulk.subcategory.trim()) patch.subcategory = bulk.subcategory.trim()
    if (bulk.name.trim()) patch.name = bulk.name.trim()
    if (bulk.receiptStatus) {
      patch.receiptStatus = bulk.receiptStatus
      patch.receiptAvailable = receiptAvailable(bulk.receiptStatus)
    }
    if (bulk.isUmsatz) patch.isUmsatz = bulk.isUmsatz === 'ja'
    // Kategorie-Wechsel vergibt je Buchung eine neue Beleg-Nummer (updateBooking)
    for (const r of visibleChecked) updateBooking(r.id, patch)
    setCheckedIds(new Set())
    setBulk({ categoryId: '', subcategory: '', name: '', receiptStatus: '', isUmsatz: '' })
  }

  async function exportRows() {
    if (rows.length === 0) return
    const suffix = filter.trim() ? '-gefiltert' : ''
    const result = await api.saveTextFile(`Buchungen-${file!.year}${suffix}.csv`, bookingsToCsv(rows))
    if (!result.ok) return
    setToast(result.path ? `CSV gespeichert: ${result.path}` : 'CSV exportiert.')
    setTimeout(() => setToast(''), 4000)
  }

  return (
    <div className="view bookings-view">
      <header className="view__header">
        <div>
          <h1 className="view__title">Buchungen</h1>
          <p className="view__subtitle">Beleg-Nummern werden automatisch je Kategorie vergeben.</p>
        </div>
      </header>

      <form className="card" onSubmit={submit}>
        <h2 className="card__title">{editingId ? 'Buchung bearbeiten' : 'Neue Buchung erfassen'}</h2>
        <div className="form-grid">
          <div className="field" style={{ gridColumn: 'span 3' }}>
            <label htmlFor="b-date">Datum</label>
            <input
              id="b-date"
              type="date"
              min={fiscalRange(file).start}
              max={fiscalRange(file).end}
              value={form.date}
              onChange={(e) => set('date', e.target.value)}
            />
          </div>
          <div className="field" style={{ gridColumn: 'span 5' }}>
            <label htmlFor="b-cat">Veranstaltung / Kategorie</label>
            <select id="b-cat" value={form.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
              {activeCats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.code})
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ gridColumn: 'span 2' }}>
            <label htmlFor="b-type">Art</label>
            <select id="b-type" value={form.type} onChange={(e) => set('type', e.target.value as BookingType)}>
              <option value="ausgabe">Ausgabe</option>
              <option value="einnahme">Einnahme</option>
            </select>
          </div>
          <div className="field" style={{ gridColumn: 'span 2' }}>
            <label htmlFor="b-amount">Betrag (€)</label>
            <AmountField
              id="b-amount"
              value={form.amount}
              onChange={(v) => set('amount', v)}
              placeholder="0,00"
            />
          </div>
          <div className="field" style={{ gridColumn: 'span 4' }}>
            <label htmlFor="b-name">Name</label>
            <input
              id="b-name"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder={form.type === 'einnahme' ? 'Zahlungspflichtige:r' : 'Empfänger:in'}
            />
          </div>
          <div className="field" style={{ gridColumn: 'span 5' }}>
            <label htmlFor="b-desc">Verwendungszweck</label>
            <input
              id="b-desc"
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="Verwendungszweck"
            />
          </div>
          <div className="form-advanced-toggle" style={{ gridColumn: 'span 12' }}>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setAdvancedOpen((open) => !open)}>
              {advancedOpen ? 'Weniger Angaben' : 'Weitere Angaben'}
            </button>
            <span className="hint">Unterkategorie, Belegstatus, Umsatz und Notiz</span>
          </div>
          {advancedOpen && (
            <>
              <div className="field" style={{ gridColumn: 'span 3' }}>
                <label htmlFor="b-sub">Unterkategorie (optional)</label>
                <input
                  id="b-sub"
                  value={form.subcategory}
                  onChange={(e) => set('subcategory', e.target.value)}
                  placeholder="z. B. Karnevalsbeiträge"
                  list="b-sub-suggestions"
                />
                <datalist id="b-sub-suggestions">
                  {subSuggestions.map((sName) => (
                    <option key={sName} value={sName} />
                  ))}
                </datalist>
              </div>
              <div className="field" style={{ gridColumn: 'span 3' }}>
                <label htmlFor="b-receipt">Belegstatus</label>
                <select id="b-receipt" value={form.receiptStatus} onChange={(e) => set('receiptStatus', e.target.value as ReceiptStatus)}>
                  <option value="vorhanden">Beleg im Ordner vorhanden</option>
                  <option value="offen">Beleg noch prüfen</option>
                  <option value="nicht_erforderlich">Kein Beleg erforderlich</option>
                </select>
              </div>
              <div className="field" style={{ gridColumn: 'span 6' }}>
                <label htmlFor="b-note">Notiz (optional)</label>
                <input id="b-note" value={form.note} onChange={(e) => set('note', e.target.value)} />
              </div>
              <div style={{ gridColumn: 'span 12', display: 'flex', gap: 'var(--space-5)', alignItems: 'center' }}>
                <label className="checkrow">
                  <input
                    type="checkbox"
                    checked={form.isUmsatz}
                    onChange={(e) => set('isUmsatz', e.target.checked)}
                  />
                  Zählt als Umsatz
                </label>
                {form.isUmsatz && (
                  <div className="field" style={{ minWidth: 180 }}>
                    <label htmlFor="b-nonumsatz">davon kein Umsatz (€, z. B. Wechselgeld)</label>
                    <AmountField
                      id="b-nonumsatz"
                      value={form.nonUmsatz}
                      onChange={(v) => set('nonUmsatz', v)}
                      placeholder="0,00"
                    />
                  </div>
                )}
              </div>
            </>
          )}
          <div style={{ gridColumn: 'span 12', display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
            {editingId && (
              <button type="button" className="btn" onClick={cancelEdit}>
                Abbrechen
              </button>
            )}
            <button className="btn btn--primary" type="submit">
              {editingId ? 'Änderungen speichern' : 'Buchung hinzufügen'}
            </button>
          </div>
          {error && (
            <div style={{ gridColumn: 'span 12', color: 'var(--color-expense)', fontSize: 'var(--text-sm)' }}>
              {error}
            </div>
          )}
        </div>
      </form>

      <section className="card bookings-list">
        <div className="toolbar bookings-list__toolbar">
          <h2 className="card__title" style={{ marginBottom: 0 }}>
            Alle Buchungen ({rows.length})
          </h2>
          <div className="toolbar__spacer" />
          <div className="field">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Suchen …"
              aria-label="Buchungen durchsuchen"
            />
          </div>
          <button className="btn btn--sm" onClick={() => void exportRows()} disabled={rows.length === 0}>
            CSV exportieren …
          </button>
        </div>
        {visibleChecked.length > 1 && (
          <div className="bulkbar">
            <strong className="bulkbar__count">{visibleChecked.length} ausgewählt</strong>
            <select
              value={bulk.categoryId}
              onChange={(e) => setBulk({ ...bulk, categoryId: e.target.value })}
              aria-label="Kategorie für Auswahl"
            >
              <option value="">Kategorie unverändert</option>
              {activeCats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <input
              value={bulk.subcategory}
              onChange={(e) => setBulk({ ...bulk, subcategory: e.target.value })}
              placeholder="Unterkategorie"
              aria-label="Unterkategorie für Auswahl"
            />
            <input
              value={bulk.name}
              onChange={(e) => setBulk({ ...bulk, name: e.target.value })}
              placeholder="Name"
              aria-label="Name für Auswahl"
            />
            <select
              value={bulk.receiptStatus}
              onChange={(e) => setBulk({ ...bulk, receiptStatus: e.target.value as '' | ReceiptStatus })}
              aria-label="Beleg für Auswahl"
            >
              <option value="">Beleg unverändert</option>
              <option value="vorhanden">Beleg: vorhanden</option>
              <option value="offen">Beleg: noch prüfen</option>
              <option value="nicht_erforderlich">Beleg: nicht erforderlich</option>
            </select>
            <select
              value={bulk.isUmsatz}
              onChange={(e) => setBulk({ ...bulk, isUmsatz: e.target.value as '' | 'ja' | 'nein' })}
              aria-label="Umsatz für Auswahl"
            >
              <option value="">Umsatz unverändert</option>
              <option value="ja">zählt als Umsatz</option>
              <option value="nein">kein Umsatz</option>
            </select>
            <button className="btn btn--sm btn--primary" disabled={!bulkHasValue} onClick={applyBulk}>
              Auf Auswahl anwenden
            </button>
          </div>
        )}
        <div className="bookings-list__scroll">
          {rows.length === 0 ? (
            <div className="empty">
              <h3>Keine Buchungen gefunden</h3>
            </div>
          ) : (
            <table className="ledger">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      checked={allVisibleChecked}
                      onChange={(e) => toggleAllVisible(e.target.checked)}
                      aria-label="Alle sichtbaren Buchungen auswählen"
                    />
                  </th>
                  <th>Nr.</th>
                  <th>Datum</th>
                  <th>Kategorie</th>
                  <th>Name</th>
                  <th>Verwendungszweck</th>
                  <th className="num">Betrag</th>
                  <th>Beleg</th>
                  <th>Umsatz</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    data-booking-id={r.id}
                    className={editingId === r.id ? 'is-selected' : undefined}
                    aria-selected={editingId === r.id}
                    tabIndex={0}
                    onClick={(event) => {
                      if (shouldStartBookingEdit(event.target as HTMLElement)) startEdit(r)
                    }}
                    onKeyDown={(event) => {
                      if (
                        shouldStartBookingEdit(event.target as HTMLElement) &&
                        (event.key === 'Enter' || event.key === ' ')
                      ) {
                        event.preventDefault()
                        startEdit(r)
                      }
                    }}
                  >
                    <td>
                      <input
                        type="checkbox"
                        checked={checkedIds.has(r.id)}
                        onChange={(e) => toggleChecked(r.id, e.target.checked)}
                        aria-label={`Buchung ${r.ref} auswählen`}
                      />
                    </td>
                    <td className="ref">{r.ref}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDate(r.date)}</td>
                    <td>
                      {r.categoryName}
                      {r.subcategory && (
                        <div>
                          <span className="pill pill--in" style={{ marginTop: 4 }}>
                            {r.subcategory}
                          </span>
                        </div>
                      )}
                    </td>
                    <td>{r.name?.trim() || '–'}</td>
                    <td className="cell-desc">
                      {r.description}
                      {r.source === 'import' && <span className="pill" style={{ marginLeft: 6 }}>Import</span>}
                      {r.note && (
                        <div className="hint hint--clamp" title={r.note}>
                          {r.note}
                        </div>
                      )}
                    </td>
                    <td className="num">
                      <Amount cents={r.signedAmount} withSign />
                    </td>
                    <td>
                      <span className={`receipt-status receipt-status--${receiptStatus(r)}`}>
                        {receiptStatusLabel(receiptStatus(r))}
                      </span>
                    </td>
                    <td>
                      {r.isUmsatz ? (
                        <span className="pill pill--in">
                          <Amount cents={r.umsatzAmount} />
                        </span>
                      ) : (
                        <span className="hint">—</span>
                      )}
                    </td>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn--ghost btn--sm" onClick={() => startEdit(r)}>
                        Bearbeiten
                      </button>
                      <button
                        className="btn btn--ghost btn--sm btn--danger"
                        onClick={() => {
                          if (confirm(`Buchung ${r.ref} („${r.description}“) wirklich löschen?`)) deleteBooking(r.id)
                        }}
                      >
                        Löschen
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
