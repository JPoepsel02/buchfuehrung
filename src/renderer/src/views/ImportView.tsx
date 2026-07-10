import { useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { parseBankCsv } from '@shared/csv'
import { buildDraft } from '@shared/importDraft'
import { BankImportPanel } from './BankView'
import { ImportDraftCard } from './ImportDraftCard'

type ImportSource = 'csv' | 'bank' | null

/**
 * Gemeinsamer Einstieg für CSV und FinTS: Beide Quellen erzeugen denselben
 * gespeicherten Entwurf, der erst danach zu Buchungen zugewiesen wird.
 */
export function ImportView() {
  const { file, update } = useStore()
  const [source, setSource] = useState<ImportSource>(null)
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
          <h1 className="view__title">Umsätze importieren</h1>
          <p className="view__subtitle">
            Kontoauszug als CSV einlesen oder Umsätze direkt per Online-Banking abrufen.
          </p>
        </div>
      </header>

      {draft ? (
        <>
          <section className="import-draft-note">
            <span className="import-draft-note__icon" aria-hidden>⇲</span>
            <span>
              <strong>Importentwurf geöffnet</strong>
              <span>{draft.fileName} · Ordne die Umsätze zu und übernimm sie anschließend als Buchungen.</span>
            </span>
          </section>
          <ImportDraftCard />
        </>
      ) : (
        <>
          <section className="import-source-grid" aria-label="Importquelle auswählen">
            <button
              className={`import-source${source === 'csv' ? ' is-active' : ''}`}
              onClick={() => {
                setSource('csv')
                void openFile()
              }}
            >
              <span className="import-source__icon" aria-hidden>⇲</span>
              <span className="import-source__content">
                <strong>CSV-Kontoauszug</strong>
                <span>Datei aus dem Online-Banking auswählen</span>
              </span>
              <span className="import-source__arrow" aria-hidden>→</span>
            </button>
            <button className={`import-source${source === 'bank' ? ' is-active' : ''}`} onClick={() => setSource('bank')}>
              <span className="import-source__icon" aria-hidden>⇄</span>
              <span className="import-source__content">
                <strong>Online-Banking</strong>
                <span>Umsätze direkt über FinTS abrufen</span>
              </span>
              <span className="import-source__arrow" aria-hidden>→</span>
            </button>
          </section>

          {source === 'bank' && <BankImportPanel />}
          {source !== 'bank' && (
            <p className="hint import-source-hint">
              Unterstützt CSV-Exporte von Sparkasse, Volksbank, ING, DKB und weiteren Banken.
            </p>
          )}
        </>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
