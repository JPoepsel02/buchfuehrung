import { useEffect, useId, useRef, useState } from 'react'
import { formatEur } from '@shared/money'
import type { Category } from '@shared/types'
import '../styles/yearEndDialog.css'

interface Props {
  yearLabel: string
  openingBalance: number
  categories: readonly Category[]
  onCancel(): void
  onConfirm(categoryIds: readonly string[]): Promise<void>
}

export function YearEndDialog({ yearLabel, openingBalance, categories, onCancel, onConfirm }: Props) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const [selected, setSelected] = useState(() => new Set(categories.map((category) => category.id)))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const allSelected = categories.every((category) => selected.has(category.id))

  useEffect(() => {
    const previous = document.activeElement
    const dialog = dialogRef.current
    dialog?.showModal()
    titleRef.current?.focus()
    return () => {
      dialog?.close()
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [])

  async function save() {
    if (saving) return
    setSaving(true)
    setError('')
    try {
      await onConfirm([...selected])
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Das Kassenjahr konnte nicht angelegt werden.')
      setSaving(false)
    }
  }

  function toggle(id: string, checked: boolean) {
    setSelected((current) => checked ? new Set([...current, id]) : new Set([...current].filter((entry) => entry !== id)))
  }

  return <dialog className="modal-panel year-end-dialog" ref={dialogRef} aria-labelledby={titleId}
    onCancel={(event) => { event.preventDefault(); if (!saving) onCancel() }}>
    <form onSubmit={(event) => { event.preventDefault(); void save() }}>
      <header>
        <h2 id={titleId} ref={titleRef} tabIndex={-1}>Jahresabschluss</h2>
        <p className="hint">Kassenjahr {yearLabel}</p>
      </header>
      <dl className="year-end-dialog__balance">
        <dt>Anfangssaldo</dt>
        <dd>{formatEur(openingBalance)}</dd>
      </dl>
      <fieldset className="year-end-dialog__categories" disabled={saving}>
        <legend>Kategorien übernehmen</legend>
        {categories.length > 0 ? <>
          <div className="year-end-dialog__choices">
            {categories.map((category) => <label className="year-end-dialog__choice" key={category.id}>
              <input type="checkbox" checked={selected.has(category.id)} onChange={(event) => toggle(category.id, event.target.checked)} />
              <span>{category.name}</span>
              <span className="hint">{category.active ? category.code : `${category.code} · Inaktiv`}</span>
            </label>)}
          </div>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setSelected(
            allSelected ? new Set() : new Set(categories.map((category) => category.id)),
          )}>{allSelected ? 'Alle abwählen' : 'Alle auswählen'}</button>
        </> : <p className="hint">Keine Kategorien vorhanden.</p>}
      </fieldset>
      {error && <p className="org-error" role="alert">{error}</p>}
      <footer className="year-end-dialog__actions">
        <button type="button" className="btn" onClick={onCancel} disabled={saving}>Abbrechen</button>
        <button type="submit" className="btn btn--primary" disabled={saving}>{saving ? 'Legt Kassenjahr an …' : 'Kassenjahr anlegen'}</button>
      </footer>
    </form>
  </dialog>
}
