import { useState } from 'react'
import logoUrl from './assets/kljb-logo.png'
import { useStore } from './store'
import { SetupView } from './views/SetupView'
import { UebersichtView } from './views/UebersichtView'
import { BuchungenView } from './views/BuchungenView'
import { ChronoView } from './views/ChronoView'
import { VeranstaltungenView } from './views/VeranstaltungenView'
import { ImportView } from './views/ImportView'
import { PruefberichtView } from './views/PruefberichtView'
import { EinstellungenView } from './views/EinstellungenView'

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

export function App() {
  const { loading, file, years, selectYear } = useStore()
  const [view, setView] = useState<ViewId>('uebersicht')

  if (loading) return null
  if (!file) return <SetupView />

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <span className="sidebar__logo">
            <img src={logoUrl} alt="" width={30} height={30} />
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
        {view === 'buchungen' && <BuchungenView />}
        {view === 'chronologisch' && <ChronoView />}
        {view === 'veranstaltungen' && <VeranstaltungenView />}
        {view === 'import' && <ImportView />}
        {view === 'pruefbericht' && <PruefberichtView />}
        {view === 'einstellungen' && <EinstellungenView />}
      </main>
    </div>
  )
}
