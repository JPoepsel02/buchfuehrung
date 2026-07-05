import { useState } from 'react'
import { AmountField } from '../components/AmountInput'
import { LogoMark } from '../components/LogoMark'
import { useStore } from '../store'
import { MONTH_NAMES, parseAmountToCents } from '@shared/money'

/** Erstes Kassenjahr eines weiteren Kontos anlegen (z. B. Karnevalskonto, Nov–Okt). */
export function KontoSetupView() {
  const { createKonto, cancelKontoSetup, settings } = useStore()
  const [name, setName] = useState('')
  const [startMonth, setStartMonth] = useState(1)
  const [year, setYear] = useState(String(new Date().getFullYear()))
  const [balance, setBalance] = useState('0,00')
  const [error, setError] = useState('')

  const label = startMonth === 1 ? year : `${year}/${Number(year) + 1}`

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const y = Number(year)
    const cents = parseAmountToCents(balance)
    if (!name.trim()) return setError('Bitte einen Konto-Namen angeben.')
    if (!Number.isInteger(y) || y < 2000 || y > 2100) return setError('Bitte ein gültiges Jahr angeben.')
    if (cents === null) return setError('Der Anfangssaldo ist kein gültiger Betrag.')
    await createKonto(name.trim(), startMonth, y, cents)
  }

  return (
    <div className="setup">
      <form className="setup__card" onSubmit={submit}>
        <div style={{ marginBottom: 'var(--space-3)' }}>
          <LogoMark logo={settings.logoDataUrl} size={72} />
        </div>
        <div className="setup__brand">Weiteres Konto anlegen</div>
        <p className="setup__sub">
          Jedes Konto wird vollständig getrennt geführt – eigene Kategorien, eigene
          Beleg-Nummern, eigenes Kassenjahr. Die Summen der Konten werden nie verrechnet.
        </p>
        <div className="form-grid">
          <div className="field" style={{ gridColumn: 'span 12' }}>
            <label htmlFor="zk-name">Name des Kontos</label>
            <input id="zk-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Festkonto" autoFocus />
          </div>
          <div className="field" style={{ gridColumn: 'span 6' }}>
            <label htmlFor="zk-month">Kassenjahr beginnt im</label>
            <select id="zk-month" value={startMonth} onChange={(e) => setStartMonth(Number(e.target.value))}>
              {MONTH_NAMES.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ gridColumn: 'span 6' }}>
            <label htmlFor="zk-year">Startjahr (Kassenjahr {label})</label>
            <input id="zk-year" value={year} onChange={(e) => setYear(e.target.value)} inputMode="numeric" />
          </div>
          <div className="field" style={{ gridColumn: 'span 6' }}>
            <label htmlFor="zk-balance">Anfangssaldo (€)</label>
            <AmountField id="zk-balance" value={balance} onChange={setBalance} />
          </div>
          <div style={{ gridColumn: 'span 12', display: 'flex', gap: 'var(--space-2)' }}>
            <button className="btn btn--primary" type="submit">
              Konto anlegen
            </button>
            <button className="btn" type="button" onClick={cancelKontoSetup}>
              Abbrechen
            </button>
            {error && (
              <span className="hint" style={{ color: 'var(--color-expense)', alignSelf: 'center' }}>
                {error}
              </span>
            )}
          </div>
        </div>
      </form>
    </div>
  )
}
