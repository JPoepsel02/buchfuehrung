import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, isElectron } from './api'
import { isLocalExperiment } from '@shared/runtime'
import { runStartupBankFetch } from './autoFetch'
import { LogoMark } from './components/LogoMark'
import { Icon } from './components/Icon'
import { YearEndNotice } from './components/YearEndNotice'
import { dueYearEnds, localCalendarDate } from './accountLifecycle'
import { useStore } from './store'
import { SetupView } from './views/SetupView'
import { KontoSetupView } from './views/KontoSetupView'
import { UebersichtView } from './views/UebersichtView'
import { BuchungenView } from './views/BuchungenView'
import { ChronoView } from './views/ChronoView'
import { VeranstaltungenView } from './views/VeranstaltungenView'
import { ImportView } from './views/ImportView'
import { PruefberichtView } from './views/PruefberichtView'
import { EinstellungenView } from './views/EinstellungenView'
import { OrganizationSettingsView } from './views/OrganizationSettingsView'
import { OrganizationView } from './views/OrganizationView'
import { ActivityAreasView } from './views/ActivityAreasView'
import { ReportsView } from './views/ReportsView'
import { PresentationView } from './views/PresentationView'
import { fiscalLabel } from '@shared/fiscal'
import { bookingMatches, computeBookings } from '@shared/ledger'
import { newImportRows } from '@shared/importRows'
import { bookingScope } from './bookingFilters'
import type { BookingFilterPreset, BookingFilterRequest } from './bookingFilters'
import { formatDate, formatEur } from '@shared/money'
import type { ComputedBooking, KontoId, YearFile } from '@shared/types'
import type { BookingReference, OrganizationPeriod } from '@shared/organization'

const ACCOUNT_VIEWS = [
  { id: 'uebersicht', label: 'Übersicht', icon: 'overview' },
  { id: 'buchungen', label: 'Buchungen', icon: 'book' },
  { id: 'chronologisch', label: 'Chronologisch', icon: 'list' },
  { id: 'veranstaltungen', label: 'Veranstaltungen', icon: 'calendar' },
  { id: 'import', label: 'Umsätze importieren', icon: 'import' },
  { id: 'einstellungen', label: 'Kontoeinstellungen', icon: 'settings' },
] as const
const ORGANIZATION_VIEWS = [
  { id: 'verein', label: 'Vereinsübersicht', icon: 'overview' },
  { id: 'bereiche', label: 'Tätigkeitsbereiche', icon: 'list' },
  { id: 'berichte', label: 'Berichte', icon: 'report' },
  { id: 'gemeinsam', label: 'Einstellungen', icon: 'settings' },
] as const
const ACCOUNT_GROUPS = [
  { label: 'Finanzen', items: ACCOUNT_VIEWS.filter((entry) => ['uebersicht', 'buchungen'].includes(entry.id)) },
  { label: 'Auswertungen', items: ACCOUNT_VIEWS.filter((entry) => ['chronologisch', 'veranstaltungen'].includes(entry.id)) },
  { label: 'Werkzeuge', items: ACCOUNT_VIEWS.filter((entry) => entry.id === 'import') },
  { label: 'Verwaltung', items: ACCOUNT_VIEWS.filter((entry) => entry.id === 'einstellungen') },
]
const VIEWS = [...ORGANIZATION_VIEWS, ...ACCOUNT_VIEWS, { id: 'pruefbericht', label: 'Kassenprüfbericht', icon: 'report' }, { id: 'praesentation', label: 'Jahrespräsentation', icon: 'report' }] as const
type ViewId = (typeof VIEWS)[number]['id']
const isMac = navigator.userAgent.includes('Macintosh')
const calendarYear = new Date().getFullYear()

export function App() {
  const { loading, restoring, file, years, selectYear, selectKontoYear, settings, konto, kontos,
    creatingKonto, startKontoSetup, allFiles, error, clearError, updateAccount } = useStore()
  const [view, setView] = useState<ViewId>('verein')
  const [today, setToday] = useState(() => localCalendarDate(new Date()))
  const [focusYearEnd, setFocusYearEnd] = useState(false)
  const [period, setPeriod] = useState<OrganizationPeriod>({ from: `${calendarYear}-01-01`, to: `${calendarYear}-12-31` })
  const [searchOpen, setSearchOpen] = useState(false)
  const [sidebarVisible, setSidebarVisible] = useState(() => window.innerWidth > 720)
  const [bookingToOpen, setBookingToOpen] = useState<{ scope: string; id: string } | null>(null)
  const [bookingPreset, setBookingPreset] = useState<BookingFilterRequest | null>(null)
  const [navigationError, setNavigationError] = useState('')
  const [bankHint, setBankHint] = useState<string | null>(null)
  const bankFetchStarted = useRef(false)
  const [sidebarKonto, setSidebarKonto] = useState<string>('haupt')
  const [reportsVisit, setReportsVisit] = useState(0)
  const lastAccountYear = useRef<Record<string, number>>({})
  const lastAccountView = useRef<Record<string, ViewId>>({})
  const consumeBookingPreset = useCallback(() => setBookingPreset(null), [])
  const isOrganizationView = ['verein', 'bereiche', 'berichte', 'gemeinsam', 'pruefbericht', 'praesentation'].includes(view)
  const dueYears = useMemo(() => dueYearEnds(allFiles, today), [allFiles, today])
  const dueAccountYears = dueYears.filter((year) => (year.konto ?? 'haupt') === konto)

  useEffect(() => {
    const refreshDate = () => setToday(localCalendarDate(new Date()))
    const timer = window.setInterval(refreshDate, 60_000)
    window.addEventListener('focus', refreshDate)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refreshDate) }
  }, [])

  useEffect(() => {
    if (loading || !file || !isElectron || isLocalExperiment || !settings.bankAccounts?.length) return
    let active = true
    void Promise.resolve().then(async () => {
      if (!active || bankFetchStarted.current) return
      bankFetchStarted.current = true
      const hint = await runStartupBankFetch({ accounts: settings.bankAccounts!, applyToAccount: updateAccount,
        onError: (label) => { if (active) setNavigationError(`Bankabruf für ${label} fehlgeschlagen. Unter „Umsätze importieren“ erneut abrufen.`) },
      })
      if (active) setBankHint(hint)
    })
    return () => { active = false }
  }, [loading, Boolean(file), settings.bankAccounts, updateAccount])

  useEffect(() => {
    if (!isOrganizationView && file) {
      setSidebarKonto(konto)
      lastAccountView.current = { ...lastAccountView.current, [konto]: view }
      lastAccountYear.current = { ...lastAccountYear.current, [konto]: file.year }
    }
  }, [view, konto, file?.year, isOrganizationView])

  useEffect(() => api.onAppCommand((command) => {
    if (command === 'search') setSearchOpen(true)
    else if (command === 'settings') setView('gemeinsam')
    else if (command === 'reports') navigate('berichte')
    else setSidebarVisible((visible) => !visible)
  }), [])
  useEffect(() => {
    const theme = settings.theme ?? 'system'
    if (theme === 'system') delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = theme
  }, [settings.theme])
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); setSearchOpen(true) }
      if ((event.metaKey || event.ctrlKey) && event.key === ',') { event.preventDefault(); setView('gemeinsam') }
      if (event.key === 'Escape') setSearchOpen(false)
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'l') { event.preventDefault(); setSidebarVisible((visible) => !visible) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const dragStrip = isElectron && isMac ? <div className="titlebar-drag" aria-hidden /> : null

  function navigate(next: ViewId, focusClosingAction = false) {
    if (next === 'berichte') setReportsVisit((visit) => visit + 1)
    setFocusYearEnd(focusClosingAction)
    setView(next)
    if (window.innerWidth <= 720) setSidebarVisible(false)
  }
  async function perform(task: () => Promise<void>) {
    try { setNavigationError(''); await task() }
    catch (failure) { setNavigationError(failure instanceof Error ? failure.message : 'Ansicht konnte nicht geöffnet werden.') }
  }
  async function openAccountView(target: string, nextView?: ViewId, selectedYear?: number, focusClosingAction = false) {
    setBookingPreset(null); setBookingToOpen(null)
    const targetView = nextView ?? lastAccountView.current[target] ?? (isOrganizationView ? 'uebersicht' : view)
    const files = allFiles.filter((entry) => (entry.konto ?? 'haupt') === target).sort((left, right) => right.year - left.year)
    const rememberedYear = selectedYear ?? lastAccountYear.current[target]
    const year = files.some((entry) => entry.year === rememberedYear) ? rememberedYear : files[0]?.year
    if (year === undefined) return
    await perform(async () => {
      await selectKontoYear(target, year)
      setSidebarKonto(target)
      navigate(targetView, focusClosingAction)
    })
  }
  function openYearEnd(year: YearFile) {
    void openAccountView(year.konto ?? 'haupt', 'einstellungen', year.year, true)
  }
  async function switchKonto(target: string) { await openAccountView(target) }
  async function openBooking(reference: BookingReference) {
    await perform(async () => {
      await selectKontoYear(reference.konto, reference.year)
      setBookingPreset(null)
      setBookingToOpen({ scope: `${reference.konto}:${reference.year}`, id: reference.bookingId })
      navigate('buchungen'); setSearchOpen(false)
    })
  }
  async function openSearchHit(hit: SearchHit) { await openBooking({ konto: hit.konto, year: hit.year, bookingId: hit.booking.id }) }
  function openOverviewTarget(target: 'buchungen' | 'import', filters?: BookingFilterPreset) {
    setBookingToOpen(null)
    setBookingPreset(target === 'buchungen' ? { scope: bookingScope(file!), filters: filters ?? {}, edit: !filters } : null)
    setView(target)
  }
  async function openAccountReport(target: 'chronologisch' | 'veranstaltungen' | 'pruefbericht' | 'praesentation', targetKonto?: string) {
    await perform(async () => {
      const id = (target === 'pruefbericht' || target === 'praesentation') ? 'haupt' : targetKonto ?? konto
      const selected = allFiles.filter((entry) => (entry.konto ?? 'haupt') === id).sort((a, b) => b.year - a.year)
      const matching = selected.find((entry) => Number(entry.year) === Number(period.to.slice(0, 4))) ?? selected[0]
      if (matching) await selectKontoYear(id, matching.year)
      setView(target)
    })
  }

  if (loading) return <div className="setup" role="status">Kassenbuch wird geöffnet …</div>
  if (restoring) return <div className="setup" role="status">Sicherung wird wiederhergestellt …</div>
  if (error && !file) return <div className="setup"><section className="card"><h1>Kassenbuch konnte nicht geöffnet werden</h1><p role="alert">{error}</p><div className="actions"><button className="btn" onClick={() => window.location.reload()}>Erneut öffnen</button>{isElectron && <button className="btn" onClick={() => void api.openDataFolder().catch(() => setNavigationError('Datenordner konnte nicht geöffnet werden.'))}>Datenordner öffnen</button>}</div>{navigationError && <p role="alert">{navigationError}</p>}</section></div>
  if (creatingKonto) return <>{dragStrip}<KontoSetupView onCreated={() => navigate(isOrganizationView ? 'uebersicht' : view)} /></>
  if (!file) return <>{dragStrip}<SetupView /></>
  const selectedSidebarKonto = kontos.some((account) => account.id === sidebarKonto) ? sidebarKonto : kontos[0]?.id ?? konto
  const sidebarFiles = allFiles.filter((entry) => (entry.konto ?? 'haupt') === selectedSidebarKonto).sort((left, right) => right.year - left.year)
  const sidebarFile = !isOrganizationView && konto === selectedSidebarKonto ? file
    : sidebarFiles.find((entry) => entry.year === lastAccountYear.current[selectedSidebarKonto]) ?? sidebarFiles[0]
  const openImportRows = sidebarFile ? newImportRows(sidebarFile).length : 0
  const selectedTitle = VIEWS.find((entry) => entry.id === view)?.label
  return <div className={`app org-app${sidebarVisible ? '' : ' app--sidebar-hidden'}${isElectron && isMac ? ' app--electron' : ''}`}>
    {dragStrip}
    <aside className="sidebar" id="app-sidebar" hidden={!sidebarVisible}>
      <div className="sidebar__brand"><span className="sidebar__logo" role="img" aria-label={settings.logoDataUrl ? 'Vereinslogo' : 'Buchführung'}><LogoMark logo={settings.logoDataUrl} size={64} /></span><button type="button" className="icon-button org-mobile-close" aria-label="Navigation schließen" onClick={() => setSidebarVisible(false)}><Icon name="close" /></button></div>
      <nav className="sidebar-primary" aria-label="Verein">
        <h2 className="sidebar__section-label">Gesamter Verein</h2>
        {ORGANIZATION_VIEWS.map((entry) => {
          const active = view === entry.id || (entry.id === 'berichte' && ['pruefbericht', 'praesentation'].includes(view))
          return <button key={entry.id} className={`navlink${active ? ' is-active' : ''}`} aria-current={active ? 'page' : undefined} onClick={() => { setBookingToOpen(null); setBookingPreset(null); navigate(entry.id) }}><span className="navlink__icon" aria-hidden="true"><Icon name={entry.icon} /></span>{entry.label}</button>
        })}
      </nav>
      <section className="sidebar-accounts" aria-label="Konten & Kassen">
        <div className="sidebar-accounts__heading"><h2 className="sidebar__section-label">Konten &amp; Kassen</h2><button className="icon-button" aria-label="Konto anlegen" title="Konto anlegen" onClick={startKontoSetup}><Icon name="plus" size={15} /></button></div>
        <div className="sidebar-account-picker">
          <label htmlFor="sidebar-account">Konto</label>
          <select id="sidebar-account" aria-label="Konto wählen" value={selectedSidebarKonto} onChange={(event) => void openAccountView(event.target.value)}>{kontos.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select>
        </div>
        <div className="sidebar-account-options">
          {sidebarFile && <div className="sidebar__year sidebar-fiscal-year"><span>Kassenjahr</span><select value={sidebarFile.year} aria-label="Jahr wählen" onChange={(event) => void openAccountView(selectedSidebarKonto, lastAccountView.current[selectedSidebarKonto] ?? 'uebersicht', Number(event.target.value))}>{sidebarFiles.map((entry) => <option key={entry.year} value={entry.year}>{fiscalLabel(entry)}</option>)}</select></div>}
          <nav aria-label="Hauptnavigation">{ACCOUNT_GROUPS.map((group) => <div className="sidebar__group" key={group.label}><h3 className="sidebar__section-label">{group.label}</h3>{group.items.map((entry) => {
            const active = !isOrganizationView && konto === selectedSidebarKonto && view === entry.id
            return <button key={entry.id} className={`navlink${active ? ' is-active' : ''}`} aria-current={active ? 'page' : undefined} onClick={() => void openAccountView(selectedSidebarKonto, entry.id)}><span className="navlink__icon" aria-hidden="true"><Icon name={entry.icon} /></span>{entry.label}{entry.id === 'import' && openImportRows > 0 && <span className="navlink__badge">{openImportRows}</span>}</button>
          })}</div>)}</nav>
        </div>
      </section>
    </aside>
    <div className="workspace"><div className="app-toolbar"><div className="app-toolbar__context"><button className="icon-button" onClick={() => setSidebarVisible((visible) => !visible)} aria-label={sidebarVisible ? 'Seitenleiste ausblenden' : 'Seitenleiste einblenden'} aria-expanded={sidebarVisible} aria-controls="app-sidebar"><Icon name="sidebar" size={20} /></button><span>{isOrganizationView ? 'Gesamter Verein' : kontos.find((entry) => entry.id === konto)?.name}</span><span className="hint">/</span><strong>{selectedTitle}</strong></div><div className="app-toolbar__actions"><button className="sidebar-search" aria-label="Buchungen suchen" onClick={() => setSearchOpen(true)}><Icon name="search" size={16} /><span>Suchen</span><kbd>{isMac ? '⌘' : 'Strg'} F</kbd></button><span className="pill">{isOrganizationView ? period.to.slice(0, 4) : fiscalLabel(file)}</span></div></div>
      {(error || navigationError) && <div className="org-global-error" role="alert"><span>{error || navigationError}</span><button className="btn btn--sm" onClick={() => { if (error) clearError(); setNavigationError('') }}>{error ? 'Erneut speichern' : 'Schließen'}</button></div>}
      {bankHint && <div className="org-global-error" role="status"><span>{bankHint}</span><button className="btn btn--sm" onClick={() => setBankHint(null)}>Schließen</button></div>}
      <main className={`main${view === 'buchungen' ? ' main--bookings' : ''}`}>
        {view === 'verein' && <OrganizationView period={period} onPeriodChange={setPeriod} onNavigate={navigate} onOpenAccount={(id) => void switchKonto(id)}
          yearEndNotice={<YearEndNotice years={dueYears} accounts={kontos} onOpen={openYearEnd} />} />}
        {view === 'bereiche' && <ActivityAreasView period={period} onOpenBooking={(reference) => void openBooking(reference)} />}
        {view === 'berichte' && <ReportsView key={reportsVisit} period={period} onPeriodChange={setPeriod} onOpenAccountReport={(target, id) => void openAccountReport(target, id)} />}
        {view === 'gemeinsam' && <OrganizationSettingsView />}
        {view === 'praesentation' && <PresentationView onBack={() => setView('berichte')} />}
        {view === 'uebersicht' && <UebersichtView onNavigate={openOverviewTarget} onOpenBooking={(id) => { setBookingPreset(null); setBookingToOpen({ scope: bookingScope(file), id }); setView('buchungen') }}
          yearEndNotice={<YearEndNotice years={dueAccountYears} accounts={kontos} onOpen={openYearEnd} />} />}
        {view === 'buchungen' && <BuchungenView key={bookingScope(file)} preset={bookingPreset} onPresetConsumed={consumeBookingPreset} bookingToOpenId={bookingToOpen?.scope === bookingScope(file) ? bookingToOpen.id : null} onBookingOpened={() => setBookingToOpen(null)} />}
        {view === 'chronologisch' && <ChronoView />}
        {view === 'veranstaltungen' && <VeranstaltungenView />}
        {view === 'import' && <ImportView />}
        {view === 'einstellungen' && <EinstellungenView focusYearEnd={focusYearEnd} yearEndDue={dueAccountYears.some((year) => year.year === file.year)} />}
        {view === 'pruefbericht' && <><div className="org-legacy-report-toolbar"><button className="btn btn--ghost" onClick={() => setView('berichte')}>← Berichte</button><label className="field"><span>Kassenjahr</span><select value={file.year} aria-label="Berichtsjahr" onChange={(event) => void perform(() => selectYear(Number(event.target.value)))}>{years.map((year) => <option key={year} value={year}>{year}</option>)}</select></label></div><PruefberichtView /></>}
      </main>
    </div>
    {searchOpen && <SearchOverlay onClose={() => setSearchOpen(false)} onSelect={(hit) => void openSearchHit(hit)} />}
  </div>
}

interface SearchHit {
  booking: ComputedBooking
  konto: KontoId
  kontoName: string
  year: number
  fiscal: string
}

interface SearchFile {
  file: YearFile
  konto: KontoId
  kontoName: string
}

/** Globale Suche (Strg/Cmd+F): standardmäßig über alle Konten und Kassenjahre. */
function SearchOverlay({ onClose, onSelect }: { onClose: () => void; onSelect: (hit: SearchHit) => void }) {
  const { file, konto, kontos, allFiles: snapshot } = useStore()
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<'all' | 'current'>('all')
  const allFiles = useMemo<SearchFile[]>(() => snapshot.map((entry) => ({ file: entry, konto: entry.konto ?? 'haupt', kontoName: kontos.find((konto) => konto.id === (entry.konto ?? 'haupt'))?.name ?? 'Konto' })), [snapshot, kontos])
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previous = document.activeElement
    inputRef.current?.focus()
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])

  const results = useMemo(() => {
    if (!query.trim()) return []
    const files: SearchFile[] =
      scope === 'current'
        ? file
          ? [{ file, konto, kontoName: kontos.find((entry) => entry.id === konto)?.name ?? 'Konto' }]
          : []
        : allFiles ?? []
    return files
      .flatMap((entry) =>
        computeBookings(entry.file)
          .filter((booking) => bookingMatches(booking, query))
          .map((booking) => ({
            booking,
            konto: entry.konto,
            kontoName: entry.kontoName,
            year: entry.file.year,
            fiscal: fiscalLabel(entry.file),
          })),
      )
      .sort((a, b) => b.booking.date.localeCompare(a.booking.date) || b.booking.seq - a.booking.seq)
      .slice(0, 24)
  }, [allFiles, file, konto, kontos, query, scope])

  return (
    <div className="search-overlay" onClick={onClose}>
      <div className="search-panel" ref={panelRef} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Buchungen durchsuchen"
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return
          const controls = panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, [tabindex="0"]')
          if (!controls?.length) return
          const first = controls[0], last = controls[controls.length - 1]
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
        }}>
        <button type="button" className="icon-button search-close" aria-label="Suche schließen" onClick={onClose}><Icon name="close" /></button>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && results[0]) onSelect(results[0])
          }}
          placeholder="Buchungen durchsuchen …"
          aria-label="Suchbegriff"
        />
        <div className="search-scope" role="group" aria-label="Suchbereich">
          <button className={scope === 'all' ? 'is-active' : ''} onClick={() => setScope('all')}>
            Alle Konten & Jahre
          </button>
          <button className={scope === 'current' ? 'is-active' : ''} onClick={() => setScope('current')}>
            Dieses Kassenjahr
          </button>
        </div>
        {query.trim() && (
          <div className="search-results">
            {scope === 'all' && !allFiles && <div className="search-empty">Durchsuche Konten und Kassenjahre …</div>}
            {results.length === 0 && (scope === 'current' || allFiles) && <div className="search-empty">Keine Treffer.</div>}
            {results.map((hit) => (
              <button key={`${hit.konto}-${hit.year}-${hit.booking.id}`} className="search-hit" onClick={() => onSelect(hit)}>
                <span className="ref">{hit.booking.ref}</span>
                <span className="search-hit__text">
                  {hit.booking.name?.trim() ? `${hit.booking.name} · ` : ''}
                  {hit.booking.description}
                  <span className="hint"> · {hit.booking.categoryName} · {formatDate(hit.booking.date)} · {hit.kontoName} {hit.fiscal}</span>
                </span>
                <span className="search-hit__amount">{formatEur(hit.booking.signedAmount)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
