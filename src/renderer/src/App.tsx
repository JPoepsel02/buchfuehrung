import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, isElectron } from './api'
import { runStartupBankFetch } from './autoFetch'
import { LogoMark } from './components/LogoMark'
import { Icon } from './components/Icon'
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
import { fiscalLabel } from '@shared/fiscal'
import { bookingMatches, computeBookings } from '@shared/ledger'
import { newImportRows } from '@shared/importRows'
import { bookingScope } from './bookingFilters'
import type { BookingFilterPreset, BookingFilterRequest } from './bookingFilters'
import { formatDate, formatEur } from '@shared/money'
import type { ComputedBooking, KontoId, YearFile } from '@shared/types'

const VIEWS = [
  { id: 'uebersicht', label: 'Übersicht', icon: 'overview' },
  { id: 'buchungen', label: 'Buchungen', icon: 'book' },
  { id: 'chronologisch', label: 'Chronologisch', icon: 'list' },
  { id: 'veranstaltungen', label: 'Veranstaltungen', icon: 'calendar' },
  { id: 'import', label: 'Umsätze importieren', icon: 'import' },
  { id: 'pruefbericht', label: 'Prüfbericht', icon: 'report' },
  { id: 'einstellungen', label: 'Einstellungen', icon: 'settings' },
] as const

type ViewId = (typeof VIEWS)[number]['id']

const isMac = navigator.userAgent.includes('Macintosh')

export function App() {
  const {
    loading,
    file,
    years,
    selectYear,
    selectKontoYear,
    settings,
    konto,
    selectKonto,
    kontos,
    creatingKonto,
    startKontoSetup,
    update,
  } = useStore()
  const [view, setView] = useState<ViewId>('uebersicht')
  const [updateHint, setUpdateHint] = useState('')
  const [bankHint, setBankHint] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [sidebarVisible, setSidebarVisible] = useState(true)
  const [bookingToOpen, setBookingToOpen] = useState<{ scope: string; id: string } | null>(null)
  const [bookingPreset, setBookingPreset] = useState<BookingFilterRequest | null>(null)
  const consumeBookingPreset = useCallback(() => setBookingPreset(null), [])
  const autoFetchStarted = useRef(false)

  useEffect(() => api.onAppCommand((command) => {
    if (command === 'search') setSearchOpen(true)
    else setSidebarVisible((visible) => !visible)
  }), [])

  // Stiller Bank-Abruf beim Start: neue Umsätze landen im Import-Entwurf
  // des jeweiligen Kontos; alles mit nötiger Interaktion wird übersprungen.
  useEffect(() => {
    if (loading || !isElectron || autoFetchStarted.current) return
    if (!settings.bankAccounts?.length) return
    autoFetchStarted.current = true
    void runStartupBankFetch({
      accounts: settings.bankAccounts,
      activeKonto: konto,
      applyToActive: update,
    }).then((summary) => {
      if (summary) {
        setBankHint(summary)
        setTimeout(() => setBankHint(''), 15000)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, settings.bankAccounts])

  // Strg/Cmd+F öffnet die globale Suche
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setSearchOpen(true)
      }
      if (e.key === 'Escape') setSearchOpen(false)
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault()
        setSidebarVisible((visible) => !visible)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Stiller Update-Check beim Start – bei neuer Version nur ein Hinweis,
  // installiert wird bewusst erst auf Klick in den Einstellungen.
  useEffect(() => {
    if (!isElectron) return
    const timer = setTimeout(() => {
      api
        .checkForUpdate()
        .then((info) => {
          if (info.hasUpdate) {
            setUpdateHint(`Neue Version ${info.latest} verfügbar – installieren unter Einstellungen → Updates.`)
            setTimeout(() => setUpdateHint(''), 12000)
          }
        })
        .catch(() => {
          // Kein Internet o. Ä. – der Start soll davon nichts merken
        })
    }, 3000)
    return () => clearTimeout(timer)
  }, [])

  // Bei ausgeblendeter Titelleiste (macOS) bleibt oben eine Greif-Leiste zum Verschieben
  const dragStrip = isElectron && isMac ? <div className="titlebar-drag" aria-hidden /> : null

  if (loading) return <div className="setup" role="status">Kassenbuch wird geöffnet …</div>
  if (creatingKonto)
    return (
      <>
        {dragStrip}
        <KontoSetupView />
      </>
    )
  if (!file)
    return (
      <>
        {dragStrip}
        <SetupView />
      </>
    )

  // Präsentation und Prüfbericht gibt es nur vom Hauptkonto aus –
  // der Prüfbericht enthält dort beide Konten.
  const navViews = VIEWS.filter((v) => konto === 'haupt' || v.id !== 'pruefbericht')

  async function switchKonto(target: string) {
    setBookingPreset(null)
    setBookingToOpen(null)
    if (target === '__neu__') {
      startKontoSetup()
      return
    }
    await selectKonto(target as KontoId)
    if (target !== 'haupt' && view === 'pruefbericht') setView('uebersicht')
  }

  async function openSearchHit(hit: SearchHit) {
    setBookingPreset(null)
    setBookingToOpen(null)
    await selectKontoYear(hit.konto, hit.year)
    setBookingToOpen({ scope: `${hit.konto}:${hit.year}`, id: hit.booking.id })
    setView('buchungen')
    setSearchOpen(false)
  }

  function openOverviewTarget(target: 'buchungen' | 'import', filters?: BookingFilterPreset) {
    setBookingToOpen(null)
    setBookingPreset(target === 'buchungen'
      ? { scope: bookingScope(file!), filters: filters ?? {}, edit: !filters }
      : null)
    setView(target)
  }

  const openImportRows = newImportRows(file).length

  return (
    <div className={`app${sidebarVisible ? '' : ' app--sidebar-hidden'}${isElectron && isMac ? ' app--electron' : ''}`}>
      {dragStrip}
      <aside className="sidebar" id="app-sidebar" hidden={!sidebarVisible}>
        <div className="sidebar__brand">
          <span className="sidebar__logo">
            <LogoMark logo={settings.logoDataUrl} size={28} />
          </span>
          Buchführung
        </div>
        <div className="sidebar__section-label">Dein Kassenbuch</div>
        <div className="sidebar__year">
          <span>Konto</span>
          <select value={konto} onChange={(e) => void switchKonto(e.target.value)} aria-label="Konto wählen">
            {kontos.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
            <option value="__neu__">+ Konto anlegen …</option>
          </select>
        </div>
        <div className="sidebar__year">
          <span>Kassenjahr</span>
          <select
            value={file.year}
            onChange={(e) => {
              setBookingPreset(null)
              setBookingToOpen(null)
              void selectYear(Number(e.target.value))
            }}
            aria-label="Jahr wählen"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {fiscalLabel({ year: y, fiscalStartMonth: file.fiscalStartMonth })}
              </option>
            ))}
          </select>
        </div>
        <nav aria-label="Hauptnavigation">
          {navViews.map((v) => (
            <Fragment key={v.id}>
            {v.id === 'uebersicht' && <div className="sidebar__section-label">Finanzen</div>}
            {v.id === 'import' && <div className="sidebar__section-label">Werkzeuge</div>}
            {v.id === 'einstellungen' && <div className="sidebar__section-label">Verwaltung</div>}
            <button
              className={`navlink${view === v.id ? ' is-active' : ''}`}
              aria-current={view === v.id ? 'page' : undefined}
              onClick={() => {
                setBookingPreset(null)
                setBookingToOpen(null)
                setView(v.id)
              }}
            >
              <span className="navlink__icon" aria-hidden>
                <Icon name={v.icon} />
              </span>
              {v.label}
              {v.id === 'import' && openImportRows > 0 && <span className="navlink__badge">{openImportRows}</span>}
            </button>
            </Fragment>
          ))}
        </nav>
        <div className="sidebar__footer">
          <div className="sidebar__identity"><Icon name="book" size={16} /><strong>{file.clubName || 'Vereinskasse'}</strong></div>
          <span>{kontos.find((entry) => entry.id === konto)?.name ?? 'Kassenbuch'} · {fiscalLabel(file)}</span>
        </div>
      </aside>
      <div className="workspace">
        <div className="app-toolbar">
          <div className="app-toolbar__context">
            <button type="button" className="icon-button" onClick={() => setSidebarVisible((visible) => !visible)}
              aria-label={sidebarVisible ? 'Seitenleiste ausblenden' : 'Seitenleiste einblenden'}
              aria-expanded={sidebarVisible} aria-controls="app-sidebar" title="Seitenleiste ein-/ausblenden">
              <Icon name="sidebar" size={20} />
            </button>
            <span>{kontos.find((entry) => entry.id === konto)?.name ?? 'Kassenbuch'}</span>
            <span aria-hidden="true" className="hint">/</span>
            <strong>{VIEWS.find((entry) => entry.id === view)?.label}</strong>
          </div>
          <div className="app-toolbar__actions">
            <button type="button" className="sidebar-search" aria-label="Buchungen suchen" onClick={() => setSearchOpen(true)}>
              <Icon name="search" size={16} /><span>Suchen</span><kbd>{isMac ? '⌘' : 'Strg'} F</kbd>
            </button>
            <span className="pill">{fiscalLabel(file)}</span>
          </div>
        </div>
      <main className={`main${view === 'buchungen' ? ' main--bookings' : ''}`}>
        {view === 'uebersicht' && <UebersichtView onNavigate={openOverviewTarget} onOpenBooking={(id) => {
          setBookingPreset(null)
          setBookingToOpen({ scope: bookingScope(file), id })
          setView('buchungen')
        }} />}
        {view === 'buchungen' && (
          <BuchungenView
            key={bookingScope(file)}
            preset={bookingPreset}
            onPresetConsumed={consumeBookingPreset}
            bookingToOpenId={bookingToOpen?.scope === bookingScope(file) ? bookingToOpen.id : null}
            onBookingOpened={() => setBookingToOpen(null)}
          />
        )}
        {view === 'chronologisch' && <ChronoView />}
        {view === 'veranstaltungen' && <VeranstaltungenView />}
        {view === 'import' && <ImportView />}
        {view === 'pruefbericht' && <PruefberichtView />}
        {view === 'einstellungen' && <EinstellungenView />}
      </main>
      </div>
      {searchOpen && <SearchOverlay onClose={() => setSearchOpen(false)} onSelect={openSearchHit} />}
      {updateHint && <div className="toast">{updateHint}</div>}
      {bankHint && <div className="toast">{bankHint}</div>}
    </div>
  )
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
  const { file, konto, kontos } = useStore()
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<'all' | 'current'>('all')
  const [allFiles, setAllFiles] = useState<SearchFile[] | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const previous = document.activeElement
    inputRef.current?.focus()
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])

  useEffect(() => {
    if (scope !== 'all') return
    let cancelled = false
    setAllFiles(null)
    setError('')
    void (async () => {
      const loaded = await Promise.all(
        kontos.map(async (entry) => {
          const years = await api.listYears(entry.id)
          const files = await Promise.all(years.map((year) => api.loadYear(entry.id, year)))
          return files
            .filter((candidate): candidate is YearFile => Boolean(candidate))
            .map((candidate) => ({ file: candidate, konto: entry.id, kontoName: entry.name }))
        }),
      )
      if (!cancelled) setAllFiles(loaded.flat())
    })().catch(() => {
      if (!cancelled) setError('Die Suche konnte nicht alle Kassenbücher laden. Versuche es erneut oder suche in diesem Kassenjahr.')
    })
    return () => {
      cancelled = true
    }
  }, [scope, kontos])

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
        {error && <p className="search-empty" role="alert">{error}</p>}
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
