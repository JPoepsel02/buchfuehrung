import { useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { parseBankCsv } from '@shared/csv'
import { buildDraft } from '@shared/importDraft'
import { ImportDraftCard } from './ImportDraftCard'

/**
 * Kontoauszug-Import: Der eingelesene Auszug wird als Entwurf in der
 * Jahresdatei gespeichert (überlebt Tab-Wechsel und Neustart). Der
 * Bank-Verwendungszweck wird nur angezeigt – übernommen wird ein eigener,
 * kurzer Verwendungszweck je Umsatz; der Original-Text landet in der Notiz.
 * Die Zuweisungstabelle selbst liegt in ImportDraftCard und wird auch vom
 * Online-Banking-Abruf verwendet.
 */
export function ImportView() {
  const { file, update } = useStore()
  const [toast, setToast] = useState('')

  if (!file) return null
  const draft = file.importDraft ?? null

  async function openFile() {
    const result = await api.openCsv()
    if (!result) return
    const parsed = parseBankCsv(result.content)
    const { mutate, messages } = buildDraft(file!, parsed.rows, result.name, parsed.skipped)
    update(mutate)
    if (messages.length > 0) {
      setToast(`${messages.join(', ')}.`)
      setTimeout(() => setToast(''), 5000)
    }
  }

  return (
    <div className="view">
      <header className="view__header">
        <div>
          <h1 className="view__title">Kontoauszug-Import</h1>
          <p className="view__subtitle">
            CSV-Exporte aus dem Online-Banking (Sparkasse, Volksbank, ING, DKB u. a.) einlesen.
          </p>
        </div>
      </header>

      {!draft ? (
        <section className="card">
          <div className="empty">
            <h3>Kontoauszug auswählen</h3>
            <p>
              Exportiere im Online-Banking deine Umsätze als CSV-Datei und wähle sie hier aus.
              <br />
              Der Auszug bleibt als Entwurf gespeichert – du kannst die Umsätze auch später
              übernehmen. Für jede Buchung vergibst du einen eigenen, kurzen Verwendungszweck.
            </p>
            <button className="btn btn--primary" onClick={() => void openFile()}>
              CSV-Datei öffnen …
            </button>
          </div>
        </section>
      ) : (
        <ImportDraftCard />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
