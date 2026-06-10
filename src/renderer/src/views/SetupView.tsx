import { useState } from 'react'
import logoUrl from '../assets/kljb-logo.png'
import { useStore } from '../store'
import { parseAmountToCents } from '@shared/money'

/** Erststart: Kassenjahr anlegen. */
export function SetupView() {
  const { createYear } = useStore()
  const [year, setYear] = useState(String(new Date().getFullYear()))
  const [balance, setBalance] = useState('0,00')
  const [clubName, setClubName] = useState('')
  const [treasurer, setTreasurer] = useState('')
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const y = Number(year)
    const cents = parseAmountToCents(balance)
    if (!Number.isInteger(y) || y < 2000 || y > 2100) {
      setError('Bitte ein gültiges Jahr angeben.')
      return
    }
    if (cents === null) {
      setError('Der Anfangssaldo ist kein gültiger Betrag.')
      return
    }
    await createYear(y, cents, clubName.trim(), treasurer.trim())
  }

  return (
    <div className="setup">
      <form className="setup__card" onSubmit={submit}>
        <img src={logoUrl} alt="KLJB Herzfeld" width={96} style={{ marginBottom: 'var(--space-3)' }} />
        <div className="setup__brand">Buchführung</div>
        <p className="setup__sub">
          Lege dein erstes Kassenjahr an. Der Anfangssaldo ist der Abschlusssaldo des Vorjahres.
        </p>
        <div className="form-grid">
          <div className="field" style={{ gridColumn: 'span 6' }}>
            <label htmlFor="setup-year">Kassenjahr</label>
            <input id="setup-year" value={year} onChange={(e) => setYear(e.target.value)} inputMode="numeric" />
          </div>
          <div className="field" style={{ gridColumn: 'span 6' }}>
            <label htmlFor="setup-balance">Anfangssaldo (€)</label>
            <input id="setup-balance" value={balance} onChange={(e) => setBalance(e.target.value)} inputMode="decimal" />
          </div>
          <div className="field" style={{ gridColumn: 'span 12' }}>
            <label htmlFor="setup-club">Verein / Ortsgruppe (für den Prüfbericht)</label>
            <input id="setup-club" value={clubName} onChange={(e) => setClubName(e.target.value)} placeholder="z. B. Ortsgruppe Musterstadt" />
          </div>
          <div className="field" style={{ gridColumn: 'span 12' }}>
            <label htmlFor="setup-treasurer">Kassenwart:in</label>
            <input id="setup-treasurer" value={treasurer} onChange={(e) => setTreasurer(e.target.value)} placeholder="Name" />
          </div>
          <div style={{ gridColumn: 'span 12' }}>
            <button className="btn btn--primary" type="submit">
              Kassenjahr anlegen
            </button>
            {error && (
              <span className="hint" style={{ color: 'var(--color-expense)', marginLeft: 12 }}>
                {error}
              </span>
            )}
          </div>
        </div>
      </form>
    </div>
  )
}
