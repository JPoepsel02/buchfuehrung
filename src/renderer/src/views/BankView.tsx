import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useStore } from '../store'
import { ImportDraftCard } from './ImportDraftCard'
import { buildDraft } from '@shared/importDraft'
import { makeId } from '@shared/defaults'
import { rowHash } from '@shared/csv'
import { formatDate } from '@shared/money'
import type { StatementRow } from '@shared/csv'
import type { BankAccountChoice, BankFetchResult, BankFetchedRow } from '@shared/bank'
import type { BankAccountConfig } from '@shared/types'

/** FinTS-Zugangsadressen der großen Rechenzentren als Vorschlag. */
const FINTS_URL_SUGGESTIONS = [
  { label: 'Volksbanken / Raiffeisenbanken (Atruvia)', url: 'https://fints2.atruvia.de/cgi-bin/hbciservlet' },
  { label: 'Volksbanken (Atruvia, ehem. GAD)', url: 'https://fints.atruvia.de/cgi-bin/hbciservlet' },
]

const DEFAULT_FINTS_URL = FINTS_URL_SUGGESTIONS[0].url

type FlowModal =
  | { kind: 'pin' }
  | { kind: 'tan'; sessionId: string; challenge: string; decoupled: boolean }
  | { kind: 'chooseAccount'; accounts: BankAccountChoice[] }

interface Flow {
  account: BankAccountConfig
  /** PIN nur im Arbeitsspeicher für die Dauer des Abrufs */
  pin?: string
  savePin: boolean
  modal: FlowModal | null
}

function isoDaysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

/**
 * Online-Banking: beliebig viele Bankkonten hinterlegen und Umsätze direkt
 * per FinTS abrufen. Abgerufene Umsätze landen als Import-Entwurf im aktiven
 * Kassenjahr und werden mit derselben Zuweisungstabelle übernommen wie ein
 * CSV-Kontoauszug.
 */
export function BankView() {
  const { file, update, settings, updateSettings } = useStore()
  const accounts = settings.bankAccounts ?? []
  const [editing, setEditing] = useState<BankAccountConfig | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [flow, setFlow] = useState<Flow | null>(null)
  const [days, setDays] = useState(30)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const continuing = useRef(false)

  if (!file) return null

  // Jedes Kassenbuch hat höchstens EINE Bankverbindung – hier zählt nur die
  // des aktiven Buchs (Einträge ohne Konto-Kennung stammen aus Altdaten = haupt).
  const bankKonto = file.konto ?? 'haupt'
  const account = accounts.find((a) => (a.konto ?? 'haupt') === bankKonto) ?? null
  const kontoLabel = bankKonto === 'haupt' ? 'Hauptkonto' : file.kontoName || 'dieses Konto'

  function showToast(text: string) {
    setToast(text)
    setTimeout(() => setToast(''), 6000)
  }

  function endFlow() {
    setFlow(null)
    setBusyId(null)
  }

  /** Vor dem ersten Abruf-Schritt: offenen Entwurf nicht ungefragt ersetzen. */
  function confirmDraftReplace(): boolean {
    if (!file!.importDraft || file!.importDraft.rows.length === 0) return true
    return confirm('Es gibt bereits einen offenen Import-Entwurf. Der Abruf ersetzt ihn – fortfahren?')
  }

  async function beginFetch(account: BankAccountConfig, pin?: string, savePin = false) {
    setError('')
    setBusyId(account.id)
    setFlow({ account, pin, savePin, modal: null })
    const result = (await api.bankFetch(account, {
      pin,
      savePin,
      from: isoDaysAgo(days),
    })) as BankFetchResult
    handleResult(account, result, pin, savePin)
  }

  function handleResult(account: BankAccountConfig, result: BankFetchResult, pin?: string, savePin = false) {
    switch (result.status) {
      case 'needPin':
        setFlow({ account, pin, savePin, modal: { kind: 'pin' } })
        return
      case 'tan':
      case 'tanPending':
        setFlow({
          account,
          pin,
          savePin,
          modal: { kind: 'tan', sessionId: result.sessionId, challenge: result.challenge, decoupled: result.decoupled },
        })
        return
      case 'chooseAccount':
        if (result.accounts.length === 1) {
          void chooseAccount(account, result.accounts[0], pin, savePin)
        } else {
          setFlow({ account, pin, savePin, modal: { kind: 'chooseAccount', accounts: result.accounts } })
        }
        return
      case 'ok':
        endFlow()
        applyRows(account, result.rows)
        return
      case 'error':
        endFlow()
        setError(result.message)
        return
    }
  }

  async function continueWithTan(sessionId: string, tan?: string) {
    if (continuing.current || !flow) return
    continuing.current = true
    try {
      const result = (await api.bankContinue(sessionId, tan)) as BankFetchResult
      handleResult(flow.account, result, flow.pin, flow.savePin)
    } finally {
      continuing.current = false
    }
  }

  async function chooseAccount(
    account: BankAccountConfig,
    choice: BankAccountChoice,
    pin?: string,
    savePin = false,
  ) {
    const withNumber = { ...account, accountNumber: choice.accountNumber, iban: choice.iban }
    await updateSettings({
      bankAccounts: accounts.map((a) => (a.id === account.id ? withNumber : a)),
    })
    await beginFetch(withNumber, pin, savePin)
  }

  function applyRows(account: BankAccountConfig, rows: BankFetchedRow[]) {
    if (rows.length === 0) {
      showToast('Die Bank hat für den gewählten Zeitraum keine Umsätze gemeldet.')
      return
    }
    const statementRows: StatementRow[] = rows.map((r) => ({
      ...r,
      hash: rowHash(r.date, r.amount, r.description),
      legacyHashes: [],
    }))
    const sourceName = `${account.label} · Abruf vom ${formatDate(new Date().toISOString().slice(0, 10))}`
    const { mutate, messages } = buildDraft(file!, statementRows, sourceName, 0)
    update(mutate)
    const extra = messages.length > 0 ? ` ${messages.join(', ')}.` : ''
    showToast(`${rows.length} Umsätze abgerufen – unten zuweisen und übernehmen.${extra}`)
  }

  async function cancelFlow() {
    if (flow?.modal?.kind === 'tan') void api.bankCancel(flow.modal.sessionId)
    endFlow()
  }

  async function removeAccount(account: BankAccountConfig) {
    if (!confirm(`Bankkonto „${account.label}" wirklich entfernen? Gespeicherte PIN und Bankdaten werden gelöscht.`)) {
      return
    }
    await api.bankForget(account.id)
    await updateSettings({ bankAccounts: accounts.filter((a) => a.id !== account.id) })
  }

  async function saveAccount(draft: BankAccountConfig) {
    const withKonto = { ...draft, konto: bankKonto }
    const next = isNew ? [...accounts, withKonto] : accounts.map((a) => (a.id === draft.id ? withKonto : a))
    await updateSettings({ bankAccounts: next })
    setEditing(null)
  }

  return (
    <div className="view">
      <header className="view__header">
        <div>
          <h1 className="view__title">Online-Banking</h1>
          <p className="view__subtitle">
            Umsätze direkt von der Bank abrufen (FinTS) und hier zuweisen – sie landen im aktiven Kassenjahr.
          </p>
        </div>
      </header>

      <section className="card">
        <div className="toolbar" style={{ marginBottom: 'var(--space-3)' }}>
          <h2 className="card__title" style={{ marginBottom: 0 }}>
            Bankverbindung · {kontoLabel}
          </h2>
          <div className="toolbar__spacer" />
          {account && (
            <label className="checkrow" style={{ whiteSpace: 'nowrap' }}>
              Zeitraum
              <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Abruf-Zeitraum">
                <option value={30}>letzte 30 Tage</option>
                <option value={60}>letzte 60 Tage</option>
                <option value={90}>letzte 90 Tage</option>
              </select>
            </label>
          )}
        </div>

        {!account && !editing && (
          <div className="empty">
            <h3>Noch keine Bankverbindung für {kontoLabel} hinterlegt</h3>
            <p>
              Jedes Kassenbuch hat seine eigene Bankverbindung – hinterlege hier das Online-Banking-Konto
              (VR-NetKey und Bankleitzahl), das zu {kontoLabel} gehört.
              <br />
              Die PIN wird ausschließlich verschlüsselt im Schlüsselbund deines Rechners gespeichert, niemals in den
              Kassendaten.
            </p>
            <button
              className="btn btn--primary"
              onClick={() => {
                setIsNew(true)
                setEditing({ id: makeId(), konto: bankKonto, label: '', blz: '', fintsUrl: DEFAULT_FINTS_URL, userId: '' })
              }}
            >
              Bankverbindung einrichten
            </button>
          </div>
        )}

        {account && (
          <table className="ledger">
            <thead>
              <tr>
                <th>Konto</th>
                <th>Bankleitzahl</th>
                <th>Anmeldename</th>
                <th>Kontonummer</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <strong>{account.label || 'Ohne Namen'}</strong>
                  {account.iban && <div className="hint">{account.iban}</div>}
                </td>
                <td>{account.blz}</td>
                <td>{account.userId}</td>
                <td>{account.accountNumber ?? <span className="hint">wird beim ersten Abruf gewählt</span>}</td>
                <td className="num" style={{ whiteSpace: 'nowrap' }}>
                  <button
                    className="btn btn--primary btn--sm"
                    disabled={busyId !== null}
                    onClick={() => {
                      if (confirmDraftReplace()) void beginFetch(account)
                    }}
                  >
                    {busyId === account.id ? 'Abruf läuft …' : 'Umsätze abrufen'}
                  </button>{' '}
                  <button
                    className="btn btn--ghost btn--sm"
                    disabled={busyId !== null}
                    onClick={() => {
                      setIsNew(false)
                      setEditing(account)
                    }}
                  >
                    Bearbeiten
                  </button>{' '}
                  <button
                    className="btn btn--ghost btn--sm btn--danger"
                    disabled={busyId !== null}
                    onClick={() => void removeAccount(account)}
                  >
                    Entfernen
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        )}

        {error && (
          <p className="hint split-editor__error" style={{ marginTop: 'var(--space-3)' }}>
            {error}
          </p>
        )}

        <p className="hint" style={{ marginTop: 'var(--space-3)' }}>
          FinTS-Produktkennung (optional, kostenlose Registrierung bei der Deutschen Kreditwirtschaft):{' '}
          <input
            defaultValue={settings.fintsProductId ?? ''}
            placeholder="Standard-Kennung verwenden"
            onBlur={(e) => void updateSettings({ fintsProductId: e.target.value.trim() || null })}
            aria-label="FinTS-Produktkennung"
            style={{ minWidth: 220 }}
          />
        </p>
      </section>

      {editing && (
        <AccountForm
          account={editing}
          isNew={isNew}
          onSave={(a) => void saveAccount(a)}
          onCancel={() => setEditing(null)}
        />
      )}

      <ImportDraftCard />

      {flow?.modal?.kind === 'pin' && (
        <PinModal
          account={flow.account}
          onSubmit={(pin, savePin) => void beginFetch(flow.account, pin, savePin)}
          onCancel={() => void cancelFlow()}
        />
      )}
      {flow?.modal?.kind === 'tan' && (
        <TanModal
          challenge={flow.modal.challenge}
          decoupled={flow.modal.decoupled}
          sessionId={flow.modal.sessionId}
          onContinue={(sessionId, tan) => void continueWithTan(sessionId, tan)}
          onCancel={() => void cancelFlow()}
        />
      )}
      {flow?.modal?.kind === 'chooseAccount' && (
        <ChooseAccountModal
          choices={flow.modal.accounts}
          onChoose={(choice) => void chooseAccount(flow.account, choice, flow.pin, flow.savePin)}
          onCancel={() => void cancelFlow()}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

/** Formular zum Anlegen/Bearbeiten eines Bankkontos (ohne PIN). */
function AccountForm({
  account,
  isNew,
  onSave,
  onCancel,
}: {
  account: BankAccountConfig
  isNew: boolean
  onSave: (account: BankAccountConfig) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(account)
  const valid = draft.label.trim() && /^\d{8}$/.test(draft.blz.trim()) && draft.fintsUrl.trim() && draft.userId.trim()

  return (
    <section className="card">
      <h2 className="card__title">{isNew ? 'Bankkonto hinzufügen' : `Bankkonto bearbeiten: ${account.label}`}</h2>
      <div className="form-grid">
        <label>
          Anzeigename
          <input
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            placeholder="z. B. Hauptkonto Volksbank"
            autoFocus
          />
        </label>
        <label>
          Bankleitzahl
          <input
            value={draft.blz}
            onChange={(e) => setDraft({ ...draft, blz: e.target.value.replace(/\s/g, '') })}
            placeholder="8-stellige Bankleitzahl"
            inputMode="numeric"
          />
        </label>
        <label>
          VR-NetKey / Anmeldename
          <input
            value={draft.userId}
            onChange={(e) => setDraft({ ...draft, userId: e.target.value })}
            placeholder="Anmeldename im Online-Banking"
          />
        </label>
        <label>
          FinTS-Zugangsadresse
          <input
            value={draft.fintsUrl}
            onChange={(e) => setDraft({ ...draft, fintsUrl: e.target.value })}
            list="fints-url-suggestions"
            placeholder="https://…"
          />
          <datalist id="fints-url-suggestions">
            {FINTS_URL_SUGGESTIONS.map((s) => (
              <option key={s.url} value={s.url}>
                {s.label}
              </option>
            ))}
          </datalist>
        </label>
      </div>
      <p className="hint">
        Die PIN wird beim ersten Abruf abgefragt und auf Wunsch verschlüsselt im Schlüsselbund gespeichert – niemals in
        den Kassendaten.
      </p>
      <div className="toolbar">
        <div className="toolbar__spacer" />
        <button className="btn btn--ghost" onClick={onCancel}>
          Abbrechen
        </button>
        <button className="btn btn--primary" disabled={!valid} onClick={() => onSave(normalize(draft))}>
          Speichern
        </button>
      </div>
    </section>
  )
}

function normalize(draft: BankAccountConfig): BankAccountConfig {
  return {
    ...draft,
    label: draft.label.trim(),
    blz: draft.blz.trim(),
    fintsUrl: draft.fintsUrl.trim(),
    userId: draft.userId.trim(),
  }
}

function PinModal({
  account,
  onSubmit,
  onCancel,
}: {
  account: BankAccountConfig
  onSubmit: (pin: string, savePin: boolean) => void
  onCancel: () => void
}) {
  const [pin, setPin] = useState('')
  const [savePin, setSavePin] = useState(true)

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="PIN eingeben">
        <h3>PIN für {account.label}</h3>
        <p className="hint">
          Die PIN deines Online-Bankings (BLZ {account.blz}). Sie wird nur für diesen Abruf verwendet
          {savePin ? ' und verschlüsselt im Schlüsselbund gespeichert' : ''}.
        </p>
        <input
          type="password"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && pin.trim()) onSubmit(pin.trim(), savePin)
          }}
          placeholder="Online-Banking-PIN"
          aria-label="PIN"
          autoFocus
        />
        <label className="checkrow" style={{ marginTop: 'var(--space-2)' }}>
          <input type="checkbox" checked={savePin} onChange={(e) => setSavePin(e.target.checked)} />
          PIN im Schlüsselbund merken
        </label>
        <div className="toolbar" style={{ marginTop: 'var(--space-3)' }}>
          <div className="toolbar__spacer" />
          <button className="btn btn--ghost" onClick={onCancel}>
            Abbrechen
          </button>
          <button className="btn btn--primary" disabled={!pin.trim()} onClick={() => onSubmit(pin.trim(), savePin)}>
            Abrufen
          </button>
        </div>
      </div>
    </div>
  )
}

const DECOUPLED_POLL_MS = 3000

function TanModal({
  challenge,
  decoupled,
  sessionId,
  onContinue,
  onCancel,
}: {
  challenge: string
  decoupled: boolean
  sessionId: string
  onContinue: (sessionId: string, tan?: string) => void
  onCancel: () => void
}) {
  const [tan, setTan] = useState('')

  // Decoupled-Freigabe (z. B. VR SecureGo plus): regelmäßig nachfragen,
  // bis die Freigabe in der Banking-App erteilt wurde.
  useEffect(() => {
    if (!decoupled) return
    const timer = setInterval(() => onContinue(sessionId), DECOUPLED_POLL_MS)
    return () => clearInterval(timer)
  }, [decoupled, sessionId, onContinue])

  return (
    <div className="modal-overlay">
      <div className="modal-panel" role="dialog" aria-label="Freigabe bestätigen">
        <h3>{decoupled ? 'Freigabe in der Banking-App' : 'TAN eingeben'}</h3>
        <p>{challenge}</p>
        {decoupled ? (
          <p className="hint">
            Bestätige die Anfrage in deiner Banking-App (z. B. VR SecureGo plus). Es wird automatisch weitergemacht,
            sobald die Freigabe eingegangen ist …
          </p>
        ) : (
          <input
            value={tan}
            onChange={(e) => setTan(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && tan.trim()) onContinue(sessionId, tan.trim())
            }}
            placeholder="TAN"
            aria-label="TAN"
            autoFocus
          />
        )}
        <div className="toolbar" style={{ marginTop: 'var(--space-3)' }}>
          <div className="toolbar__spacer" />
          <button className="btn btn--ghost" onClick={onCancel}>
            Abbrechen
          </button>
          {!decoupled && (
            <button className="btn btn--primary" disabled={!tan.trim()} onClick={() => onContinue(sessionId, tan.trim())}>
              Bestätigen
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function ChooseAccountModal({
  choices,
  onChoose,
  onCancel,
}: {
  choices: BankAccountChoice[]
  onChoose: (choice: BankAccountChoice) => void
  onCancel: () => void
}) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Konto auswählen">
        <h3>Welches Konto soll abgerufen werden?</h3>
        <p className="hint">Die Bank hat mehrere Konten gemeldet. Die Auswahl wird für künftige Abrufe gemerkt.</p>
        <div className="modal-choices">
          {choices.map((choice) => (
            <button key={choice.accountNumber} className="search-hit" onClick={() => onChoose(choice)}>
              <span className="search-hit__text">
                <strong>{choice.product ?? 'Konto'}</strong> · {choice.iban ?? choice.accountNumber}
                {choice.holder && <span className="hint"> · {choice.holder}</span>}
              </span>
            </button>
          ))}
        </div>
        <div className="toolbar" style={{ marginTop: 'var(--space-3)' }}>
          <div className="toolbar__spacer" />
          <button className="btn btn--ghost" onClick={onCancel}>
            Abbrechen
          </button>
        </div>
      </div>
    </div>
  )
}
