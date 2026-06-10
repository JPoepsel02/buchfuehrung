import { useState } from 'react'
import { api, isElectron } from '../api'
import { useStore } from '../store'
import { yearTotals } from '@shared/ledger'
import { formatEur, parseAmountToCents } from '@shared/money'

export function EinstellungenView() {
  const { file, update, createYear, addCategory, updateCategory, deleteCategory } = useStore()
  const [toast, setToast] = useState('')
  const [newCat, setNewCat] = useState({ name: '', code: '' })
  const [balanceInput, setBalanceInput] = useState(() =>
    file ? (file.openingBalance / 100).toFixed(2).replace('.', ',') : '0,00',
  )

  if (!file) return null
  const totals = yearTotals(file)
  const cats = [...file.categories].sort((a, b) => a.sortOrder - b.sortOrder)

  function notify(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 4000)
  }

  function saveBalance() {
    const cents = parseAmountToCents(balanceInput)
    if (cents === null) return notify('Ungültiger Betrag.')
    update((f) => ({ ...f, openingBalance: cents }))
    notify('Anfangssaldo gespeichert.')
  }

  function addNewCategory(e: React.FormEvent) {
    e.preventDefault()
    const name = newCat.name.trim()
    const code = newCat.code.trim().toUpperCase()
    if (!name || !code) return notify('Name und Kürzel angeben.')
    if (file!.categories.some((c) => c.code === code)) return notify(`Kürzel „${code}“ ist bereits vergeben.`)
    const maxSort = Math.max(0, ...file!.categories.map((c) => c.sortOrder))
    addCategory({ name, code, sortOrder: maxSort + 10, active: true })
    setNewCat({ name: '', code: '' })
  }

  function move(id: string, dir: -1 | 1) {
    const idx = cats.findIndex((c) => c.id === id)
    const other = cats[idx + dir]
    if (!other) return
    const current = cats[idx]
    updateCategory(current.id, { sortOrder: other.sortOrder })
    updateCategory(other.id, { sortOrder: current.sortOrder })
  }

  async function startNextYear() {
    const nextYear = file!.year + 1
    if (
      !confirm(
        `Jahresabschluss: Kassenjahr ${nextYear} anlegen?\n\nDer Abschlusssaldo ${formatEur(totals.closingBalance)} wird als Anfangssaldo übernommen, die Kategorien werden kopiert.`,
      )
    )
      return
    await createYear(nextYear, totals.closingBalance, file!.clubName, file!.treasurerName)
    notify(`Kassenjahr ${nextYear} angelegt.`)
  }

  return (
    <div className="view">
      <header className="view__header">
        <div>
          <h1 className="view__title">Einstellungen</h1>
        </div>
      </header>

      <section className="card">
        <h2 className="card__title">Kassenjahr {file.year}</h2>
        <div className="form-grid">
          <div className="field" style={{ gridColumn: 'span 4' }}>
            <label htmlFor="s-club">Verein / Ortsgruppe</label>
            <input
              id="s-club"
              value={file.clubName}
              onChange={(e) => update((f) => ({ ...f, clubName: e.target.value }))}
            />
          </div>
          <div className="field" style={{ gridColumn: 'span 4' }}>
            <label htmlFor="s-treasurer">Kassenwart:in</label>
            <input
              id="s-treasurer"
              value={file.treasurerName}
              onChange={(e) => update((f) => ({ ...f, treasurerName: e.target.value }))}
            />
          </div>
          <div className="field" style={{ gridColumn: 'span 2' }}>
            <label htmlFor="s-balance">Anfangssaldo (€)</label>
            <input
              id="s-balance"
              value={balanceInput}
              onChange={(e) => setBalanceInput(e.target.value)}
              onBlur={saveBalance}
              inputMode="decimal"
            />
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <button className="btn" onClick={() => void startNextYear()}>
              Jahresabschluss → {file.year + 1}
            </button>
          </div>
        </div>
        {isElectron && (
          <p className="hint" style={{ marginBottom: 0 }}>
            Daten werden lokal gespeichert (mit automatischen Backups). {' '}
            <button className="btn btn--ghost btn--sm" onClick={() => void api.openDataFolder()}>
              Datenordner öffnen
            </button>
          </p>
        )}
      </section>

      <section className="card">
        <h2 className="card__title">Veranstaltungen / Kategorien</h2>
        <table className="ledger">
          <thead>
            <tr>
              <th>Name</th>
              <th>Kürzel</th>
              <th>Aktiv</th>
              <th>Reihenfolge</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {cats.map((c, i) => (
              <tr key={c.id}>
                <td>
                  <input
                    value={c.name}
                    onChange={(e) => updateCategory(c.id, { name: e.target.value })}
                    style={{ border: 'none', background: 'transparent', width: '100%', font: 'inherit' }}
                    aria-label="Kategoriename"
                  />
                </td>
                <td className="ref">{c.code}</td>
                <td>
                  <input
                    type="checkbox"
                    checked={c.active}
                    onChange={(e) => updateCategory(c.id, { active: e.target.checked })}
                    aria-label="Kategorie aktiv"
                  />
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn btn--ghost btn--sm" disabled={i === 0} onClick={() => move(c.id, -1)} aria-label="Nach oben">
                    ↑
                  </button>
                  <button
                    className="btn btn--ghost btn--sm"
                    disabled={i === cats.length - 1}
                    onClick={() => move(c.id, 1)}
                    aria-label="Nach unten"
                  >
                    ↓
                  </button>
                </td>
                <td className="num">
                  <button
                    className="btn btn--ghost btn--sm btn--danger"
                    onClick={() => {
                      if (!deleteCategory(c.id))
                        notify('Kategorie hat Buchungen und kann nicht gelöscht werden. Stattdessen deaktivieren.')
                    }}
                  >
                    Löschen
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <form className="toolbar" style={{ marginTop: 'var(--space-4)' }} onSubmit={addNewCategory}>
          <div className="field">
            <input
              value={newCat.name}
              onChange={(e) => setNewCat((s) => ({ ...s, name: e.target.value }))}
              placeholder="Neue Veranstaltung / Kategorie"
              aria-label="Name der neuen Kategorie"
            />
          </div>
          <div className="field" style={{ width: 90 }}>
            <input
              value={newCat.code}
              onChange={(e) => setNewCat((s) => ({ ...s, code: e.target.value }))}
              placeholder="Kürzel"
              aria-label="Kürzel der neuen Kategorie"
            />
          </div>
          <button className="btn" type="submit">
            Hinzufügen
          </button>
        </form>
        <p className="hint">
          Das Kürzel bestimmt die Beleg-Nummern (z. B. „M“ → M1, M2 …). Die Reihenfolge steuert die
          Sortierung im Veranstaltungs-Blatt und im Prüfbericht.
        </p>
      </section>
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
