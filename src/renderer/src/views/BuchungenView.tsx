import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import { Amount } from '../components/Amount'
import { AmountField } from '../components/AmountInput'
import { computeBookings } from '@shared/ledger'
import { formatDate, parseAmountToCents } from '@shared/money'
import type { Booking, BookingType } from '@shared/types'

interface FormState {
  date: string
  categoryId: string
  description: string
  type: BookingType
  amount: string
  isUmsatz: boolean
  nonUmsatz: string
  note: string
}

const emptyForm = (categoryId: string, year: number): FormState => ({
  date: new Date().getFullYear() === year ? new Date().toISOString().slice(0, 10) : `${year}-01-01`,
  categoryId,
  description: '',
  type: 'ausgabe',
  amount: '',
  isUmsatz: false,
  nonUmsatz: '',
  note: '',
})

export function BuchungenView({
  externalFilter = '',
  onFilterConsumed,
}: {
  /** Suchbegriff aus der globalen Strg+F-Suche */
  externalFilter?: string
  onFilterConsumed?: () => void
}) {
  const { file, addBooking, updateBooking, deleteBooking } = useStore()
  const activeCats = useMemo(
    () => (file ? file.categories.filter((c) => c.active).sort((a, b) => a.sortOrder - b.sortOrder) : []),
    [file],
  )
  const [form, setForm] = useState<FormState>(() => emptyForm(activeCats[0]?.id ?? '', file?.year ?? 2026))
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('')

  // Suchbegriff aus der globalen Strg+F-Suche übernehmen
  useEffect(() => {
    if (externalFilter) {
      setFilter(externalFilter)
      onFilterConsumed?.()
    }
  }, [externalFilter, onFilterConsumed])

  if (!file) return null
  const rows = computeBookings(file)
    .sort((a, b) => b.seq - a.seq)
    .filter((r) => {
      if (!filter.trim()) return true
      const q = filter.toLowerCase()
      return (
        r.description.toLowerCase().includes(q) ||
        r.categoryName.toLowerCase().includes(q) ||
        r.ref.toLowerCase().includes(q)
      )
    })

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function startEdit(b: Booking) {
    setEditingId(b.id)
    setForm({
      date: b.date,
      categoryId: b.categoryId,
      description: b.description,
      type: b.type,
      amount: (b.amount / 100).toFixed(2).replace('.', ','),
      isUmsatz: b.isUmsatz,
      nonUmsatz: b.nonUmsatzAmount ? (b.nonUmsatzAmount / 100).toFixed(2).replace('.', ',') : '',
      note: b.note,
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const amount = parseAmountToCents(form.amount)
    const nonUmsatz = form.nonUmsatz.trim() ? parseAmountToCents(form.nonUmsatz) : 0
    if (!form.date || !/^\d{4}-\d{2}-\d{2}$/.test(form.date)) return setError('Bitte ein Datum wählen.')
    if (!form.categoryId) return setError('Bitte eine Kategorie wählen.')
    if (!form.description.trim()) return setError('Bitte einen Verwendungszweck angeben.')
    if (amount === null || amount <= 0) return setError('Bitte einen gültigen Betrag größer 0 angeben.')
    if (nonUmsatz === null || nonUmsatz < 0) return setError('„Davon kein Umsatz“ ist kein gültiger Betrag.')
    if (nonUmsatz > amount) return setError('„Davon kein Umsatz“ darf den Betrag nicht übersteigen.')

    const data = {
      date: form.date,
      categoryId: form.categoryId,
      description: form.description.trim(),
      type: form.type,
      amount,
      isUmsatz: form.isUmsatz,
      nonUmsatzAmount: form.isUmsatz ? nonUmsatz : 0,
      note: form.note.trim(),
      source: 'manuell' as const,
    }
    if (editingId) {
      updateBooking(editingId, data)
      setEditingId(null)
    } else {
      addBooking(data)
    }
    setForm((f) => ({ ...emptyForm(f.categoryId, file!.year), date: f.date }))
  }

  function cancelEdit() {
    setEditingId(null)
    setForm(emptyForm(activeCats[0]?.id ?? '', file!.year))
    setError('')
  }

  return (
    <div className="view">
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
            <input id="b-date" type="date" value={form.date} onChange={(e) => set('date', e.target.value)} />
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
          <div className="field" style={{ gridColumn: 'span 8' }}>
            <label htmlFor="b-desc">Verwendungszweck</label>
            <input
              id="b-desc"
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="z. B. Erstattung Pizza Generalversammlung"
            />
          </div>
          <div className="field" style={{ gridColumn: 'span 4' }}>
            <label htmlFor="b-note">Notiz (optional)</label>
            <input id="b-note" value={form.note} onChange={(e) => set('note', e.target.value)} />
          </div>
          <div style={{ gridColumn: 'span 8', display: 'flex', gap: 'var(--space-5)', alignItems: 'center' }}>
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
          <div style={{ gridColumn: 'span 4', display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
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

      <section className="card">
        <div className="toolbar" style={{ marginBottom: 'var(--space-4)' }}>
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
        </div>
        {rows.length === 0 ? (
          <div className="empty">
            <h3>Keine Buchungen gefunden</h3>
          </div>
        ) : (
          <table className="ledger">
            <thead>
              <tr>
                <th>Nr.</th>
                <th>Datum</th>
                <th>Kategorie</th>
                <th>Verwendungszweck</th>
                <th className="num">Betrag</th>
                <th>Umsatz</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="ref">{r.ref}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatDate(r.date)}</td>
                  <td>{r.categoryName}</td>
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
      </section>
    </div>
  )
}
