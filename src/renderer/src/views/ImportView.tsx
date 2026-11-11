import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { Icon } from '../components/Icon'
import { parseBankCsv } from '@shared/csv'
import { mergeImportResponse } from '../importResponse'
import { newImportRows } from '@shared/importRows'
import { BankImportPanel } from './BankView'
import { ImportDraftCard } from './ImportDraftCard'

type ImportSource = 'csv' | 'bank' | null

/**
 * Gemeinsamer Einstieg für CSV und FinTS: Beide Quellen erzeugen denselben
 * gespeicherten Entwurf, der erst danach zu Buchungen zugewiesen wird.
 */
export function ImportView() {
  const { file, updateAccount } = useStore()
  const [source, setSource] = useState<ImportSource>(null)
  const [toast, setToast] = useState('')
  const [error, setError] = useState('')
  const mounted = useRef(true)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scope = file ? `${file.konto ?? 'haupt'}:${file.year}` : ''
  const currentScope = useRef(scope)
  currentScope.current = scope

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (toastTimer.current) clearTimeout(toastTimer.current)
    }
  }, [])
  useEffect(() => { setSource(null); setToast(''); setError('') }, [scope])

  if (!file) return null
  const draft = newImportRows(file).length > 0 ? file.importDraft : null

  function showToast(message: string) {
    setToast(message)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 5000)
  }

  async function openFile() {
    const target = { konto: file!.konto ?? 'haupt', year: file!.year, scope }
    setError('')
    try {
      const result = await api.openCsv()
      if (!result) return
      const parsed = parseBankCsv(result.content)
      let imported: ReturnType<typeof mergeImportResponse> | undefined
      await updateAccount(target.konto, target.year, (current) => {
        imported = mergeImportResponse(current, parsed.rows, result.name, parsed.skipped)
        return imported.file
      })
      if (!imported || !mounted.current || currentScope.current !== target.scope) return
      const { freshCount, messages } = imported
      if (messages.length > 0 || freshCount === 0) {
        showToast([...(freshCount === 0 ? ['Keine neuen Umsätze gefunden'] : []), ...messages].join('. ') + '.')
      }
    } catch (failure) {
      if (mounted.current && currentScope.current === target.scope) {
        setError(failure instanceof Error ? failure.message : 'CSV-Datei konnte nicht importiert werden.')
      }
    }
  }

  return (
    <div className="view">
      <header className="view__header">
        <h1 className="view__title">Umsätze importieren</h1>
        {draft && <button className="btn" aria-expanded={source === 'bank'}
          onClick={() => setSource(source === 'bank' ? null : 'bank')}>Online-Banking</button>}
      </header>

      {!draft && (
        <>
          <section className="import-source-grid" aria-label="Importquelle auswählen">
            <button
              className={`import-source${source === 'csv' ? ' is-active' : ''}`}
              onClick={() => {
                setSource('csv')
                void openFile()
              }}
            >
              <span className="import-source__icon"><Icon name="import" size={22} /></span>
              <span className="import-source__content">
                <strong>CSV-Kontoauszug</strong>
                <span>Datei aus dem Online-Banking auswählen</span>
              </span>
              <span className="import-source__arrow"><Icon name="arrow" size={18} /></span>
            </button>
            <button className={`import-source${source === 'bank' ? ' is-active' : ''}`} onClick={() => setSource('bank')}>
              <span className="import-source__icon"><Icon name="turnover" size={22} /></span>
              <span className="import-source__content">
                <strong>Online-Banking</strong>
                <span>Umsätze direkt über FinTS abrufen</span>
              </span>
              <span className="import-source__arrow"><Icon name="arrow" size={18} /></span>
            </button>
          </section>

          {source !== 'bank' && (
            <p className="hint import-source-hint">
              Unterstützt CSV-Exporte von Sparkasse, Volksbank, ING, DKB und weiteren Banken.
            </p>
          )}
        </>
      )}
      {source === 'bank' && <BankImportPanel key={scope} onFetchResult={(message) => {
        if (mounted.current && currentScope.current === scope) showToast(message)
      }} />}
      {draft && <ImportDraftCard key={scope} onImported={showToast} />}
      {error && <p role="alert" className="org-error">{error}</p>}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
