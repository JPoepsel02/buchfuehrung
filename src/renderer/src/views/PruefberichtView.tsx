import { useMemo, useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { buildReportHtml } from '../report'
import { exportAnnualPresentation } from '../presentationExport'
import { ReportPreview } from '../components/ReportPreview'
import { fiscalLabel, fiscalRange } from '@shared/fiscal'
import { accountNumberFor } from '@shared/accountDetails'
import type { AuditInfo } from '@shared/types'

const AUDIT_FIELDS: { key: keyof AuditInfo; label: string; span: number; placeholder?: string }[] = [
  { key: 'pruefer1', label: 'Kassenprüfer:in 1', span: 4 },
  { key: 'pruefer2', label: 'Kassenprüfer:in 2', span: 4 },
  { key: 'pruefDatum', label: 'Datum der Prüfung', span: 2, placeholder: 'TT.MM.JJJJ' },
  { key: 'wahlDatum', label: 'Mitgliederversammlung (Wahl)', span: 2, placeholder: 'TT.MM.JJJJ' },
  { key: 'gvDatum', label: 'Generalversammlung (Entlastung)', span: 2, placeholder: 'TT.MM.JJJJ' },
  { key: 'ort', label: 'Ort', span: 3, placeholder: 'z. B. Münster' },
]

const AUDIT_DATE_FIELDS = new Set<keyof AuditInfo>(['pruefDatum', 'wahlDatum', 'gvDatum'])

export function PruefberichtView({ embedded = false }: { embedded?: boolean } = {}) {
  const { file, settings, update, kontos, allFiles, organization, flush } = useStore()
  const [toast, setToast] = useState('')
  const [exporting, setExporting] = useState(false)
  const Heading = embedded ? 'h2' : 'h1'
  const SectionHeading = embedded ? 'h3' : 'h2'
  const reportEndYear = file ? Number(fiscalRange(file).end.slice(0, 4)) : null
  const otherKontos = kontos.filter((entry) => entry.id !== 'haupt')
  const excluded = new Set(file?.reportExcludedKontos ?? [])
  const otherIds = otherKontos.filter((entry) => !excluded.has(entry.id)).map((entry) => entry.id).join(',')
  const others = useMemo(() => {
    if (!file || !otherIds) return []
    return otherIds.split(',').flatMap((id) => {
      const matching = allFiles.filter((entry) => (entry.konto ?? 'haupt') === id && Number(fiscalRange(entry).end.slice(0, 4)) === reportEndYear).sort((a,b) => b.year - a.year)[0]
      return matching ? [{ ...matching, kontoName: kontos.find((entry) => entry.id === id)?.name ?? matching.kontoName }] : []
    })
  }, [reportEndYear, otherIds, allFiles, kontos])
  const reportFile = useMemo(() => file ? { ...file,
    kontoName: kontos.find((entry) => entry.id === (file.konto ?? 'haupt'))?.name ?? file.kontoName,
    clubName: organization.name || file.clubName,
    treasurerName: organization.treasurerName || file.treasurerName,
  } : null, [file, kontos, organization.name, organization.treasurerName])
  const missing = otherIds.split(',').filter((id) => id && !others.some((entry) => (entry.konto ?? 'haupt') === id))
  const selectedKontos = kontos.filter((entry) => !excluded.has(entry.id))
  const selectionMessage = selectedKontos.length === 0 ? 'Bitte mindestens ein Konto auswählen.'
    : missing.length > 0 ? `Fehlendes Kassenjahr: ${missing.map((id) => kontos.find((entry) => entry.id === id)?.name ?? id).join(', ')}` : ''
  const selectedFiles = reportFile ? [reportFile, ...others].filter((entry) => !excluded.has(entry.konto ?? 'haupt')) : []

  const html = useMemo(
    () => (reportFile && !selectionMessage ? buildReportHtml(reportFile, settings.logoDataUrl, others, settings) : ''),
    [reportFile, selectionMessage, settings, others],
  )
  if (!file) return null
  const audit = file.audit ?? {}

  function setAudit(key: keyof AuditInfo, value: string) {
    update((f) => ({ ...f, audit: { ...f.audit, [key]: value } }))
  }

  function toggleKonto(kontoId: string, includeInReport: boolean) {
    update((f) => {
      const next = new Set(f.reportExcludedKontos ?? [])
      if (includeInReport) next.delete(kontoId)
      else next.add(kontoId)
      return { ...f, reportExcludedKontos: next.size > 0 ? [...next] : undefined }
    })
  }

  function notify(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 5000)
  }

  async function exportPdf() {
    if (exporting || selectionMessage || !html) return
    setExporting(true)
    try {
      await flush()
      const result = await api.exportPdf(html, `Kassenpruefbericht-${file!.year}.pdf`)
      if (result.ok) notify(result.path ? `PDF gespeichert: ${result.path}` : 'PDF erstellt.')
    } catch (failure) { notify(failure instanceof Error ? failure.message : 'Export fehlgeschlagen.') }
    finally { setExporting(false) }
  }
  async function exportPresentation(format: 'pdf' | 'pptx') {
    if (exporting || selectionMessage || !reportFile) return
    setExporting(true)
    try {
      await flush()
      const result = await exportAnnualPresentation(reportFile, settings.logoDataUrl, format)
      if (result.ok) notify(result.path ? `Präsentation gespeichert: ${result.path}` : 'Präsentation erstellt.')
    } catch (failure) { notify(failure instanceof Error ? failure.message : 'Export fehlgeschlagen.') }
    finally { setExporting(false) }
  }

  return (
    <div className={embedded ? 'org-embedded-report' : 'view'}>
      <header className="view__header">
        <div>
          <Heading className="view__title">Kassenprüfbericht {file.year}</Heading>

        </div>
        <div className="toolbar">
          <button className="btn" disabled={exporting || Boolean(selectionMessage)} onClick={() => void exportPresentation('pptx')}>
            Jahres-Präsentation (PPTX) …
          </button>
          <button className="btn" disabled={exporting || Boolean(selectionMessage)} onClick={() => void exportPresentation('pdf')}>
            Jahres-Präsentation (PDF) …
          </button>
          <button className="btn btn--primary" disabled={exporting || Boolean(selectionMessage) || !html} onClick={() => void exportPdf()}>
            Prüfbericht als PDF …
          </button>
        </div>
      </header>

      {selectionMessage && <p className="org-issues" role="status">{selectionMessage}</p>}
      <div className="stats">
        <div className="stat">
          <div className="stat__label">Ausgewählte Konten</div>
          <div className="stat__value">{selectedKontos.length}</div>
        </div>
        <div className="stat">
          <div className="stat__label">Inhalt</div>
          <ul className="stat__hint" style={{ margin: '8px 0 0', paddingLeft: 16, display: 'block' }}>
            {selectedFiles.map((entry) => <li key={entry.konto ?? 'haupt'}>{[entry.kontoName, accountNumberFor(entry.konto ?? 'haupt', settings)].filter(Boolean).join(' ')} · {fiscalLabel(entry)}</li>)}
          </ul>
        </div>
      </div>

        <section className="card">
          <SectionHeading className="card__title">Konten im Bericht</SectionHeading>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-4)' }}>
            {kontos.map((k) => (
              <label className="checkrow" key={k.id}>
                <input
                  type="checkbox"
                  checked={!excluded.has(k.id)}
                  onChange={(e) => toggleKonto(k.id, e.target.checked)}
                  aria-label={`${k.name} im Bericht`}
                />
                {k.name}
              </label>
            ))}
          </div>
        </section>

      <section className="card">
        <SectionHeading className="card__title">Angaben zur Kassenprüfung</SectionHeading>
        <div className="form-grid">
          {AUDIT_FIELDS.map((f) => (
            <div className="field" key={f.key} style={{ gridColumn: `span ${f.span}` }}>
              <label htmlFor={`audit-${f.key}`}>{f.label}</label>
              <input
                id={`audit-${f.key}`}
                type={AUDIT_DATE_FIELDS.has(f.key) ? 'date' : 'text'}
                value={
                  AUDIT_DATE_FIELDS.has(f.key)
                    ? toDateInputValue(audit[f.key] as string | undefined, file.year)
                    : ((audit[f.key] as string | undefined) ?? '')
                }
                onChange={(e) => setAudit(f.key, e.target.value)}
                placeholder={f.placeholder}
              />
            </div>
          ))}
        </div>
        <p className="hint" style={{ marginBottom: 0 }}>
          Diese Angaben füllen die letzte Seite des Prüfberichts (Vorlage „Bericht der
          Kassenprüfer“). Leere Felder erscheinen im Druck als Schreiblinie.
        </p>
      </section>

      {html ? <ReportPreview html={html} title="Vorschau Prüfbericht" width={1000} />
        : <p className="org-status" style={{ margin: 12 }}>Keine Vorschau verfügbar.</p>}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

function toDateInputValue(value: string | undefined, fallbackYear: number): string {
  const parsed = parseAuditDate(value, fallbackYear)
  return parsed ?? ''
}

function parseAuditDate(value: string | undefined, fallbackYear: number): string | null {
  const raw = (value ?? '').trim()
  if (!raw) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw

  const match = /^(\d{1,2})\.(\d{1,2})\.(?:(\d{2}|\d{4}))?$/.exec(raw)
  if (!match) return null
  const day = Number(match[1])
  const month = Number(match[2])
  const yearRaw = match[3]
  const year = yearRaw ? (yearRaw.length === 2 ? 2000 + Number(yearRaw) : Number(yearRaw)) : fallbackYear
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
