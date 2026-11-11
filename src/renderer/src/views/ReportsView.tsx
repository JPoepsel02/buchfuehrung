import { useEffect, useMemo, useRef, useState } from 'react'
import { buildOrganizationReport, confirmedAccountStarts } from '@shared/organization'
import type { OrganizationPeriod } from '@shared/organization'
import { fiscalLabel, fiscalRange } from '@shared/fiscal'
import { buildOrganizationReportHtml, canExportOrganizationReport, ORGANIZATION_REPORT_TITLES, organizationReportToCsv } from '../organizationReport'
import type { OrganizationReportKind } from '../organizationReport'
import { api } from '../api'
import { useStore } from '../store'
import { Icon } from '../components/Icon'
import { PruefberichtView } from './PruefberichtView'
import { PresentationView } from './PresentationView'
import '../styles/reports.css'

interface Props {
  period: OrganizationPeriod
  onPeriodChange(period: OrganizationPeriod): void
  onOpenAccountReport(view: 'chronologisch' | 'veranstaltungen' | 'pruefbericht' | 'praesentation', konto?: string): void
}

type ReportKind = OrganizationReportKind | 'audit' | 'presentation'

const REPORT_GROUPS: ReadonlyArray<{
  title: string
  reports: ReadonlyArray<{ id: ReportKind; title: string; description: string; icon: 'report' | 'list' | 'calendar' | 'shield' }>
}> = [
  { title: 'Auswertungen', reports: [
    { id: 'eur', title: ORGANIZATION_REPORT_TITLES.eur, description: 'Einnahmen und Ausgaben nach Tätigkeitsbereichen.', icon: 'report' },
    { id: 'bookings', title: ORGANIZATION_REPORT_TITLES.bookings, description: 'Buchungen aller ausgewählten Konten.', icon: 'list' },
    { id: 'events', title: ORGANIZATION_REPORT_TITLES.events, description: 'Einnahmen und Ausgaben je Veranstaltung.', icon: 'calendar' },
  ] },
  { title: 'Jahresabschluss', reports: [
    { id: 'audit', title: 'Kassenprüfbericht', description: 'Kassenprüfung, Belegübersicht und Unterschriften.', icon: 'shield' },
    { id: 'presentation', title: 'Jahrespräsentation', description: 'Jahresübersicht als PDF-Präsentation.', icon: 'report' },
  ] },
]

export function ReportsView({ period, onPeriodChange }: Props) {
  const { allFiles, organization, settings, kontos, file, selectKontoYear, flush } = useStore()
  const [kind, setKind] = useState<ReportKind | null>(null)
  const [selectedKontos, setSelectedKontos] = useState<string[] | null>(null)
  const [legacyYear, setLegacyYear] = useState<number | null>(null)
  const [loadingLegacy, setLoadingLegacy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const legacyRequest = useRef(0)
  const catalog = useRef<HTMLElement>(null)
  const backButton = useRef<HTMLButtonElement>(null)
  const lastReport = useRef<ReportKind | null>(null)
  const standardKind = kind === 'audit' || kind === 'presentation' ? null : kind
  const mainFiles = useMemo(() => [...new Map(allFiles
    .filter((entry) => (entry.konto ?? 'haupt') === 'haupt')
    .map((entry) => [entry.year, entry] as const)).values()].sort((left, right) => right.year - left.year), [allFiles])
  const reportPeriod = useMemo(() => ({ ...period, kontos: selectedKontos ?? period.kontos }), [period, selectedKontos])
  const report = useMemo(() => buildOrganizationReport(allFiles, organization, reportPeriod), [allFiles, organization, reportPeriod])
  const html = useMemo(() => standardKind ? buildOrganizationReportHtml(report, organization, settings.logoDataUrl, standardKind) : '', [report, organization, settings.logoDataUrl, standardKind])
  const accountStarts = useMemo(() => confirmedAccountStarts(allFiles), [allFiles])
  const reportKontos = kontos.filter((konto) => (accountStarts.get(konto.id) ?? '') <= period.to)
  const included = selectedKontos ?? period.kontos ?? kontos.map((konto) => konto.id)
  const legacyReady = file && (file.konto ?? 'haupt') === 'haupt' && file.year === legacyYear
  const exportDisabled = busy || !standardKind || !canExportOrganizationReport(report, standardKind)

  useEffect(() => () => { legacyRequest.current += 1 }, [])
  useEffect(() => {
    if (kind !== null) backButton.current?.focus()
    else if (lastReport.current) catalog.current?.querySelector<HTMLButtonElement>(`[data-report="${lastReport.current}"]`)?.focus()
  }, [kind])

  function toggleKonto(id: string, checked: boolean) {
    const next = checked ? [...new Set([...included, id])] : included.filter((entry) => entry !== id)
    setSelectedKontos(next)
  }
  async function exportFile(format: 'pdf' | 'csv') {
    if (!standardKind || exportDisabled) return
    setBusy(true); setError(''); setMessage('')
    try {
      await flush()
      const name = `${standardKind === 'eur' ? 'Einnahmenueberschussrechnung' : ORGANIZATION_REPORT_TITLES[standardKind]}-${period.from}-${period.to}`
      const result = format === 'pdf'
        ? await api.exportPdf(html, `${name}.pdf`, { landscape: true })
        : await api.saveTextFile(`${name}.csv`, organizationReportToCsv(report, organization, standardKind))
      if (result.ok) setMessage(result.path ? `Gespeichert: ${result.path}` : 'Bericht gespeichert.')
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Der Bericht konnte nicht gespeichert werden.') }
    finally { setBusy(false) }
  }

  async function openLegacyYear(year: number) {
    const request = ++legacyRequest.current
    setLegacyYear(year); setLoadingLegacy(true); setError('')
    try { await selectKontoYear('haupt', year) }
    catch (failure) {
      if (request === legacyRequest.current) setError(failure instanceof Error ? failure.message : 'Das Kassenjahr konnte nicht geöffnet werden.')
    } finally { if (request === legacyRequest.current) setLoadingLegacy(false) }
  }

  function selectReport(next: ReportKind) {
    lastReport.current = next
    setKind(next); setMessage(''); setError('')
    if (next !== 'audit' && next !== 'presentation') {
      legacyRequest.current += 1; setLoadingLegacy(false)
      return
    }
    const matching = mainFiles.find((entry) => {
      const range = fiscalRange(entry)
      return range.start <= period.to && range.end >= period.to
    })
    const previous = mainFiles.find((entry) => fiscalRange(entry).start <= period.to)
    const selected = legacyYear !== null && mainFiles.some((entry) => entry.year === legacyYear)
      ? legacyYear : matching?.year ?? previous?.year ?? mainFiles[0]?.year
    if (selected !== undefined) void openLegacyYear(selected)
  }

  function showCatalog() {
    legacyRequest.current += 1
    setLoadingLegacy(false); setKind(null); setMessage(''); setError('')
  }

  if (kind === null) return <div className="view org-reports-view reports-overview">
    <header className="view__header"><h1 className="view__title">Berichte</h1></header>
    <nav className="reports-catalog" aria-label="Berichtsarten" ref={catalog}>
      {REPORT_GROUPS.map((group) => <section className="reports-group" key={group.title} aria-labelledby={`reports-group-${group.title}`}>
        <h2 className="reports-group-title" id={`reports-group-${group.title}`}>{group.title}</h2>
        <div className="reports-grid">{group.reports.map((entry) => <button
          key={entry.id} className="reports-tile" data-report={entry.id} aria-label={entry.title} onClick={() => selectReport(entry.id)}>
          <span className="reports-tile-top"><span className="reports-tile-icon"><Icon name={entry.icon} size={24} /></span><span className="reports-tile-arrow"><Icon name="arrow" size={18} /></span></span>
          <strong className="reports-tile-title">{entry.title}</strong>
          <span className="reports-tile-description">{entry.description}</span>
        </button>)}</div>
      </section>)}
    </nav>
  </div>

  return <div className="view org-reports-view">
    <header className="view__header"><h1 className="view__title">Berichte</h1>{standardKind && <div className="toolbar"><button className="btn" disabled={exportDisabled} onClick={() => void exportFile('csv')}><Icon name="import" size={16} />CSV</button><button className="btn btn--primary" disabled={exportDisabled} onClick={() => void exportFile('pdf')}><Icon name="report" size={16} />PDF exportieren</button></div>}</header>
    <div className="reports-back-row"><button className="btn btn--ghost reports-back" ref={backButton} onClick={showCatalog}><Icon name="arrow" size={16} />Alle Berichte</button></div>
    {error && <p className="org-error" role="alert">{error}</p>}{message && <p className="org-status" role="status">{message}</p>}
    <div className="org-report-layout">
      <aside className="card org-report-options reports-detail-filters">
        {standardKind ? <section className="org-report-group org-report-filters">
          <h2 className="org-report-group-title org-report-filter-title">Zeitraum &amp; Konten</h2>
          <div className="field"><label htmlFor="report-from">Von</label><input id="report-from" type="date" value={period.from} max={period.to} onChange={(event) => event.target.value && onPeriodChange({ ...period, from: event.target.value })} /></div>
          <div className="field"><label htmlFor="report-to">Bis</label><input id="report-to" type="date" value={period.to} min={period.from} onChange={(event) => event.target.value && onPeriodChange({ ...period, to: event.target.value })} /></div>
          <div className="org-report-kontos">{reportKontos.map((konto) => <label className="checkrow" key={konto.id}><input type="checkbox" checked={included.includes(konto.id)} onChange={(event) => toggleKonto(konto.id, event.target.checked)} />{konto.name}</label>)}</div>
          <div className={`org-status${report.openCount || report.issues.length ? ' org-status--warn' : ''}`}>{report.issues.length ? 'Abgleich erforderlich' : report.openCount ? `${report.openCount} Zuordnungen offen` : 'Zuordnung vollständig'}</div>
        </section> : <section className="org-report-group org-report-filters">
          <h2 className="org-report-group-title org-report-filter-title">Kassenjahr</h2>
          <div className="field"><label htmlFor="legacy-report-year">Hauptkonto</label><select id="legacy-report-year" aria-label="Kassenjahr des Berichts" value={legacyYear ?? ''} disabled={loadingLegacy || mainFiles.length === 0} onChange={(event) => void openLegacyYear(Number(event.target.value))}>
            {mainFiles.length === 0 && <option value="">Kein Kassenjahr vorhanden</option>}
            {mainFiles.map((entry) => <option key={entry.year} value={entry.year}>{fiscalLabel(entry)}</option>)}
          </select></div>
        </section>}
      </aside>
      <div className="org-report-document">
        {standardKind ? <section className="org-report-preview"><iframe title={`${ORGANIZATION_REPORT_TITLES[standardKind]} – Vorschau`} sandbox="" srcDoc={html} /></section>
          : loadingLegacy ? <p className="org-status" role="status">Kassenjahr wird geöffnet …</p>
            : !legacyReady ? <p className="org-issues">Kein Kassenjahr des Hauptkontos vorhanden.</p>
              : kind === 'audit' ? <PruefberichtView embedded /> : <PresentationView embedded />}
      </div>
    </div>
  </div>
}
