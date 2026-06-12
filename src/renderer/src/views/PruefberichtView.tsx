import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { buildReportHtml } from '../report'
import { buildPresentationHtml } from '../presentation'
import { fiscalLabel, fiscalRange } from '@shared/fiscal'
import { yearTotals } from '@shared/ledger'
import { formatEur } from '@shared/money'
import type { AuditInfo, YearFile } from '@shared/types'

const AUDIT_FIELDS: { key: keyof AuditInfo; label: string; span: number; placeholder?: string }[] = [
  { key: 'pruefer1', label: 'Kassenprüfer:in 1', span: 4 },
  { key: 'pruefer2', label: 'Kassenprüfer:in 2', span: 4 },
  { key: 'konto1', label: 'Geprüftes Konto 1', span: 3, placeholder: 'z. B. 100 000 000' },
  { key: 'konto2', label: 'Geprüftes Konto 2 (optional)', span: 3 },
  { key: 'pruefDatum', label: 'Datum der Prüfung', span: 2, placeholder: 'TT.MM.JJJJ' },
  { key: 'wahlDatum', label: 'Mitgliederversammlung (Wahl)', span: 2, placeholder: 'TT.MM.JJJJ' },
  { key: 'gvDatum', label: 'Generalversammlung (Entlastung)', span: 2, placeholder: 'TT.MM.JJJJ' },
  { key: 'ort', label: 'Ort', span: 3, placeholder: 'z. B. Münster' },
]

const AUDIT_DATE_FIELDS = new Set<keyof AuditInfo>(['pruefDatum', 'wahlDatum', 'gvDatum'])

export function PruefberichtView() {
  const { file, settings, update, zweitExists } = useStore()
  const [toast, setToast] = useState('')
  const [zweit, setZweit] = useState<YearFile | null>(null)

  // Wirtschaftsjahr des Zweitkontos laden: bevorzugt das Jahr, dessen Ende im
  // Kassenjahr des Hauptkontos liegt (Nov 2025–Okt 2026 gehört zu 2026) –
  // sonst einfach das neueste, damit das Zweitkonto immer im Bericht steht.
  useEffect(() => {
    if (!file || !zweitExists) {
      setZweit(null)
      return
    }
    let cancelled = false
    ;(async () => {
      const years = await api.listYears('zweit')
      let fallback: YearFile | null = null
      for (const candidate of years) {
        const data = (await api.loadYear('zweit', candidate)) as YearFile | null
        if (!data) continue
        fallback ??= data
        if (Number(fiscalRange(data).end.slice(0, 4)) === file.year) {
          if (!cancelled) setZweit(data)
          return
        }
      }
      if (!cancelled) setZweit(fallback)
    })()
    return () => {
      cancelled = true
    }
  }, [file, zweitExists])

  const html = useMemo(
    () => (file ? buildReportHtml(file, settings.logoDataUrl, zweit) : ''),
    [file, settings.logoDataUrl, zweit],
  )
  if (!file) return null
  const totals = yearTotals(file)
  const audit = file.audit ?? {}

  function setAudit(key: keyof AuditInfo, value: string) {
    update((f) => ({ ...f, audit: { ...f.audit, [key]: value } }))
  }

  function notify(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 5000)
  }

  async function exportPdf() {
    const result = await api.exportPdf(html, `Kassenbericht-${file!.year}.pdf`)
    if (result.ok) notify(result.path ? `PDF gespeichert: ${result.path}` : 'PDF erstellt.')
  }

  async function exportPresentation() {
    const presentation = buildPresentationHtml(file!, settings.logoDataUrl)
    const result = await api.exportPdf(presentation, `Kassenbericht-${file!.year}-Praesentation.pdf`, {
      landscape: true,
    })
    if (result.ok) notify(result.path ? `Präsentation gespeichert: ${result.path}` : 'Präsentation erstellt.')
  }

  return (
    <div className="view">
      <header className="view__header">
        <div>
          <h1 className="view__title">Prüfbericht {file.year}</h1>
          <p className="view__subtitle">
            Druckfertiges PDF für die Kassenprüfung – mit Abhak-Kästchen je Beleg und dem
            Kassenprüfbericht nach Vereinsvorlage.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flex: 'none' }}>
          <button className="btn" onClick={() => void exportPresentation()}>
            Jahres-Präsentation (PDF) …
          </button>
          <button className="btn btn--primary" onClick={() => void exportPdf()}>
            Prüfbericht als PDF …
          </button>
        </div>
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
            Hauptkonto: Zusammenfassung · Chronologie · Veranstaltungen
            {zweit ? ` · danach ${zweit.kontoName || 'Zweitkonto'} ${fiscalLabel(zweit)} (getrennt, keine Gesamtsummen)` : ''}
            {' '}· Kassenprüfbericht mit Unterschriften
          </div>
        </div>
      </div>

      <section className="card">
        <h2 className="card__title">Angaben zur Kassenprüfung</h2>
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
