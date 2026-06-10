import { useMemo, useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { buildReportHtml } from '../report'
import { yearTotals } from '@shared/ledger'
import { formatEur } from '@shared/money'

export function PruefberichtView() {
  const { file, settings } = useStore()
  const [toast, setToast] = useState('')
  const html = useMemo(
    () => (file ? buildReportHtml(file, settings.logoDataUrl) : ''),
    [file, settings.logoDataUrl],
  )
  if (!file) return null
  const totals = yearTotals(file)

  async function exportPdf() {
    const result = await api.exportPdf(html, `Kassenbericht-${file!.year}.pdf`)
    if (result.ok) {
      setToast(result.path ? `PDF gespeichert: ${result.path}` : 'PDF erstellt.')
      setTimeout(() => setToast(''), 5000)
    }
  }

  return (
    <div className="view">
      <header className="view__header">
        <div>
          <h1 className="view__title">Prüfbericht {file.year}</h1>
          <p className="view__subtitle">
            Druckfertiges PDF für die Kassenprüfung – mit Abhak-Kästchen je Beleg und Unterschriftsfeldern.
          </p>
        </div>
        <button className="btn btn--primary" onClick={() => void exportPdf()}>
          Als PDF exportieren …
        </button>
      </header>

      <div className="stats">
        <div className="stat">
          <div className="stat__label">Buchungen</div>
          <div className="stat__value">{totals.count}</div>
        </div>
        <div className="stat">
          <div className="stat__label">Abschlusssaldo</div>
          <div className="stat__value">{formatEur(totals.closingBalance)}</div>
        </div>
        <div className="stat">
          <div className="stat__label">Inhalt</div>
          <div className="stat__hint" style={{ marginTop: 8 }}>
            Zusammenfassung · Chronologie · Veranstaltungen · Prüfvermerk mit Unterschriften
          </div>
        </div>
      </div>

      <section className="card" style={{ padding: 'var(--space-3)' }}>
        <iframe
          title="Vorschau Prüfbericht"
          srcDoc={html}
          sandbox=""
          style={{
            width: '100%',
            height: '70vh',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            background: 'white',
          }}
        />
      </section>
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
