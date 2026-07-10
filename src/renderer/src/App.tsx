import { useEffect, useMemo, useRef, useState } from 'react'
import { api, isElectron } from './api'
import { runStartupBankFetch } from './autoFetch'
import { LogoMark } from './components/LogoMark'
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
import { formatDate, formatEur } from '@shared/money'
import type { ComputedBooking, KontoId, YearFile } from '@shared/types'

const VIEWS = [
  { id: 'uebersicht', label: 'Übersicht', icon: '◫' },
  { id: 'buchungen', label: 'Buchungen', icon: '✎' },
  { id: 'chronologisch', label: 'Chronologisch', icon: '☰' },
  { id: 'veranstaltungen', label: 'Veranstaltungen', icon: '⊞' },
  { id: 'import', label: 'Umsätze importieren', icon: '⇲' },
  { id: 'pruefbericht', label: 'Prüfbericht', icon: '✓' },
  { id: 'einstellungen', label: 'Einstellungen', icon: '⚙' },
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
  const [bookingToOpenId, setBookingToOpenId] = useState<string | null>(null)
  const autoFetchStarted = useRef(false)

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

  if (loading) return null
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
    if (target === '__neu__') {
      startKontoSetup()
      return
    }
    await selectKonto(target as KontoId)
    if (target !== 'haupt' && view === 'pruefbericht') setView('uebersicht')
  }

  async function openSearchHit(hit: SearchHit) {
    await selectKontoYear(hit.konto, hit.year)
    setBookingToOpenId(hit.booking.id)
    setView('buchungen')
    setSearchOpen(false)
  }

  const openImportRows = file.importDraft?.rows.length ?? 0

  return (
    <div className="app">
      {dragStrip}
      <aside className="sidebar">
        <div className="sidebar__brand">
          <span className="sidebar__logo">
            <LogoMark logo={settings.logoDataUrl} size={30} />
          </span>
          Buchführung
        </div>
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
            onChange={(e) => void selectYear(Number(e.target.value))}
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
            <button
              key={v.id}
              className={`navlink${view === v.id ? ' is-active' : ''}`}
              onClick={() => setView(v.id)}
            >
              <span className="navlink__icon" aria-hidden>
                {v.icon}
              </span>
              {v.label}
              {v.id === 'import' && openImportRows > 0 && <span className="navlink__badge">{openImportRows}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar__footer">
          {konto !== 'haupt' ? file.kontoName || 'Konto' : file.clubName || 'Verein'} · {fiscalLabel(file)}
        </div>
      </aside>
      <main className={`main${view === 'buchungen' ? ' main--bookings' : ''}`}>
        {view === 'uebersicht' && <UebersichtView onNavigate={(target) => setView(target)} />}
        {view === 'buchungen' && (
          <BuchungenView bookingToOpenId={bookingToOpenId} onBookingOpened={() => setBookingToOpenId(null)} />
        )}
        {view === 'chronologisch' && <ChronoView />}
        {view === 'veranstaltungen' && <VeranstaltungenView />}
        {view === 'import' && <ImportView />}
        {view === 'pruefbericht' && <PruefberichtView />}
        {view === 'einstellungen' && <EinstellungenView />}
      </main>
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

  useEffect(() => inputRef.current?.focus(), [])

  useEffect(() => {
    if (scope !== 'all') return
    let cancelled = false
    setAllFiles(null)
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
    })()
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
      <div className="search-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Buchungen durchsuchen">
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
