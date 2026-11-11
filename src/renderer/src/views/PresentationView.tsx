import { useMemo, useState } from 'react'
import { buildPresentationHtml } from '../presentation'
import { exportAnnualPresentation } from '../presentationExport'
import { ReportPreview } from '../components/ReportPreview'
import { useStore } from '../store'

export function PresentationView({ onBack, embedded = false }: { onBack?(): void; embedded?: boolean }) {
  const { file, organization, settings, years, selectYear, flush } = useStore()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const presentationFile = useMemo(() => file ? { ...file, clubName: organization.name || file.clubName, treasurerName: organization.treasurerName || file.treasurerName } : null, [file, organization.name, organization.treasurerName])
  const html = useMemo(() => presentationFile ? buildPresentationHtml(presentationFile, settings.logoDataUrl) : '', [presentationFile, settings.logoDataUrl])
  const Heading = embedded ? 'h2' : 'h1'
  if (!file) return null
  async function exportFile(format: 'pdf' | 'pptx') {
    if (busy || !presentationFile) return
    setError(''); setMessage(''); setBusy(true)
    try {
      await flush()
      const result = await exportAnnualPresentation(presentationFile, settings.logoDataUrl, format)
      if (result.ok) setMessage(result.path ? `Gespeichert: ${result.path}` : 'Präsentation gespeichert.')
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Export fehlgeschlagen.') }
    finally { setBusy(false) }
  }
  return <div className={embedded ? 'org-embedded-report' : 'view'}>
    {!embedded && <div className="org-legacy-report-toolbar">{onBack && <button className="btn btn--ghost" onClick={onBack}>← Berichte</button>}<label className="field"><span>Kassenjahr</span><select value={file.year} aria-label="Präsentationsjahr" onChange={(event) => void selectYear(Number(event.target.value)).catch((failure: Error) => setError(failure.message))}>{years.map((year) => <option key={year} value={year}>{year}</option>)}</select></label></div>}
    <header className="view__header"><Heading className="view__title">Jahrespräsentation {file.year}</Heading><div className="toolbar"><button className="btn" disabled={busy} onClick={() => void exportFile('pptx')}>PowerPoint exportieren</button><button className="btn btn--primary" disabled={busy} onClick={() => void exportFile('pdf')}>PDF exportieren</button></div></header>
    {error && <p className="org-error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <ReportPreview html={html} title="Jahrespräsentation – Vorschau" width={1280} />
  </div>
}
