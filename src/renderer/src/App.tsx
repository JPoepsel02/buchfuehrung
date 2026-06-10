import { useEffect, useMemo, useRef, useState } from 'react'
import { api, isElectron } from './api'
import { LogoMark } from './components/LogoMark'
import { useStore } from './store'
import { SetupView } from './views/SetupView'
import { UebersichtView } from './views/UebersichtView'
import { BuchungenView } from './views/BuchungenView'
import { ChronoView } from './views/ChronoView'
import { VeranstaltungenView } from './views/VeranstaltungenView'
import { ImportView } from './views/ImportView'
import { PruefberichtView } from './views/PruefberichtView'
import { EinstellungenView } from './views/EinstellungenView'
import { bookingMatches, computeBookings } from '@shared/ledger'
import { formatDate, formatEur } from '@shared/money'

const VIEWS = [
  { id: 'uebersicht', label: 'Übersicht', icon: '◫' },
  { id: 'buchungen', label: 'Buchungen', icon: '✎' },
  { id: 'chronologisch', label: 'Chronologisch', icon: '☰' },
  { id: 'veranstaltungen', label: 'Veranstaltungen', icon: '⊞' },
  { id: 'import', label: 'Kontoauszug-Import', icon: '⇲' },
  { id: 'pruefbericht', label: 'Prüfbericht', icon: '✓' },
  { id: 'einstellungen', label: 'Einstellungen', icon: '⚙' },
] as const

type ViewId = (typeof VIEWS)[number]['id']

const isMac = navigator.userAgent.includes('Macintosh')

export function App() {
  const { loading, file, years, selectYear, settings } = useStore()
  const [view, setView] = useState<ViewId>('uebersicht')
  const [updateHint, setUpdateHint] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [bookingsFilter, setBookingsFilter] = useState('')

  // Farbschema anwenden (hell/dunkel/system) – auch schon im Setup
  useEffect(() => {
    const theme = settings.theme ?? 'system'
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = theme === 'dunkel' || (theme === 'system' && mq.matches)
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [settings.theme])

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
  if (!file)
    return (
      <>
        {dragStrip}
        <SetupView />
      </>
    )

  function jumpToBooking(term: string) {
    setBookingsFilter(term)
    setView('buchungen')
    setSearchOpen(false)
  }

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
          <span>Kassenjahr</span>
          <select
            value={file.year}
            onChange={(e) => void selectYear(Number(e.target.value))}
            aria-label="Kassenjahr wählen"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <nav aria-label="Hauptnavigation">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              className={`navlink${view === v.id ? ' is-active' : ''}`}
              onClick={() => setView(v.id)}
            >
              <span className="navlink__icon" aria-hidden>
                {v.icon}
              </span>
              {v.label}
            </button>
          ))}
        </nav>
        <div className="sidebar__footer">{file.clubName || 'Verein'} · {file.year}</div>
      </aside>
      <main className="main">
        {view === 'uebersicht' && <UebersichtView />}
        {view === 'buchungen' && (
          <BuchungenView externalFilter={bookingsFilter} onFilterConsumed={() => setBookingsFilter('')} />
        )}
        {view === 'chronologisch' && <ChronoView />}
        {view === 'veranstaltungen' && <VeranstaltungenView />}
        {view === 'import' && <ImportView />}
        {view === 'pruefbericht' && <PruefberichtView />}
        {view === 'einstellungen' && <EinstellungenView />}
      </main>
      {searchOpen && <SearchOverlay onClose={() => setSearchOpen(false)} onJump={jumpToBooking} />}
      {updateHint && <div className="toast">{updateHint}</div>}
    </div>
  )
}

/** Globale Suche (Strg/Cmd+F): durchsucht alle Buchungen des Kassenjahres. */
function SearchOverlay({ onClose, onJump }: { onClose: () => void; onJump: (term: string) => void }) {
  const { file } = useStore()
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => inputRef.current?.focus(), [])

  const results = useMemo(() => {
    if (!file || !query.trim()) return []
    return computeBookings(file)
      .filter((r) => bookingMatches(r, query))
      .slice(0, 12)
  }, [file, query])

  return (
    <div className="search-overlay" onClick={onClose}>
      <div className="search-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Buchungen durchsuchen">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && query.trim()) onJump(query.trim())
          }}
          placeholder="Buchungen durchsuchen … (Enter zeigt alle Treffer)"
          aria-label="Suchbegriff"
        />
        {query.trim() && (
          <div className="search-results">
            {results.length === 0 && <div className="search-empty">Keine Treffer.</div>}
            {results.map((r) => (
              <button key={r.id} className="search-hit" onClick={() => onJump(query.trim())}>
                <span className="ref">{r.ref}</span>
                <span className="search-hit__text">
                  {r.description}
                  <span className="hint"> · {r.categoryName} · {formatDate(r.date)}</span>
                </span>
                <span className="search-hit__amount">{formatEur(r.signedAmount)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
