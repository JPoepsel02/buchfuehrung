import { useEffect, useRef, useState } from 'react'
import { api, isElectron } from '../api'
import { BankDialog, BankPinSettings } from '../components/BankPinSettings'
import { useStore } from '../store'
import { mergeImportResponse } from '../importResponse'
import { makeId } from '@shared/defaults'
import { legacyRowHashes, rowHash } from '@shared/csv'
import { formatDate } from '@shared/money'
import { validateBankAccountConfig } from '@shared/bankValidation'
import type { StatementRow } from '@shared/csv'
import type { BankAccountChoice, BankFetchResult, BankFetchedRow } from '@shared/bank'
import type { BankAccountConfig, KontoId } from '@shared/types'

/** FinTS-Zugangsadressen der großen Rechenzentren als Vorschlag. */
const FINTS_URL_SUGGESTIONS = [
  { label: 'Atruvia · FinTS 1', url: 'https://fints1.atruvia.de/cgi-bin/hbciservlet' },
  { label: 'Atruvia · FinTS 2', url: 'https://fints2.atruvia.de/cgi-bin/hbciservlet' },
]

type FlowModal =
  | { kind: 'pin' }
  | { kind: 'tan'; sessionId: string; challenge: string; decoupled: boolean }
  | { kind: 'chooseAccount'; accounts: BankAccountChoice[] }

interface Flow {
  account: BankAccountConfig
  request: FetchRequest
  /** PIN nur im Arbeitsspeicher für die Dauer des Abrufs */
  pin?: string
  savePin: boolean
  modal: FlowModal | null
}

interface FetchRequest {
  id: string
  target: { konto: KontoId; year: number }
  sessionId?: string
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
/** Eingebetteter Online-Banking-Weg innerhalb von „Umsätze importieren“. */
export function BankImportPanel({ onFetchResult }: { onFetchResult: (message: string) => void }) {
  const { file, updateAccount, settings, updateSettings } = useStore()
  const accounts = settings.bankAccounts ?? []
  const [editing, setEditing] = useState<BankAccountConfig | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [flow, setFlow] = useState<Flow | null>(null)
  const [days, setDays] = useState(30)
  const [error, setError] = useState('')
  const continuing = useRef(false)
  const mounted = useRef(true)
  const activeRequest = useRef<FetchRequest | null>(null)
  const cancelledRequests = useRef<Set<string>>(new Set())
  const currentScope = useRef('')
  const latestAccounts = useRef(accounts)
  latestAccounts.current = accounts
  currentScope.current = file ? `${file.konto ?? 'haupt'}:${file.year}` : ''

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      const request = activeRequest.current
      if (request?.sessionId) {
        cancelledRequests.current = new Set([...cancelledRequests.current, request.id])
        void cancelSession(request.sessionId)
      }
    }
  }, [])

  if (!file) return null

  // Jedes Kassenbuch hat höchstens EINE Bankverbindung – hier zählt nur die
  // des aktiven Buchs (Einträge ohne Konto-Kennung stammen aus Altdaten = haupt).
  const bankKonto = file.konto ?? 'haupt'
  const account = accounts.find((a) => (a.konto ?? 'haupt') === bankKonto) ?? null
  const kontoLabel = bankKonto === 'haupt' ? 'Hauptkonto' : file.kontoName || 'dieses Konto'

  function isCurrentView(request: FetchRequest): boolean {
    return mounted.current && currentScope.current === `${request.target.konto}:${request.target.year}`
  }

  function endFlow(request: FetchRequest) {
    if (activeRequest.current?.id !== request.id) return
    activeRequest.current = null
    if (mounted.current) { setFlow(null); setBusyId(null) }
  }

  async function cancelSession(sessionId: string) {
    try { await api.bankCancel(sessionId) }
    catch { if (mounted.current) setError('Die Bankfreigabe konnte nicht abgebrochen werden. Bitte den Abruf in der Banking-App prüfen.') }
  }

  function newRequest(): FetchRequest {
    return { id: makeId(), target: { konto: bankKonto, year: file!.year } }
  }

  function enterPin(account: BankAccountConfig) {
    const request = newRequest()
    activeRequest.current = request
    setError('')
    setFlow({ account, request, savePin: false, modal: { kind: 'pin' } })
  }

  async function beginFetch(account: BankAccountConfig, pin?: string, savePin = false, previousRequest?: FetchRequest) {
    const request = previousRequest ?? newRequest()
    if (cancelledRequests.current.has(request.id)) return
    activeRequest.current = request
    if (isCurrentView(request)) {
      setError(''); setBusyId(account.id)
      setFlow({ account, request, pin, savePin, modal: null })
    }
    try {
      const result = (await api.bankFetch(account, { pin, savePin, from: isoDaysAgo(days) })) as BankFetchResult
      await handleResult(account, request, result, pin, savePin)
    } catch (failure) {
      endFlow(request)
      if (isCurrentView(request)) setError(failure instanceof Error ? failure.message : 'Der Bankabruf ist fehlgeschlagen.')
    }
  }

  async function handleResult(account: BankAccountConfig, request: FetchRequest, result: BankFetchResult, pin?: string, savePin = false) {
    if (cancelledRequests.current.has(request.id)) {
      if (result.status === 'tan' || result.status === 'tanPending') await cancelSession(result.sessionId)
      return
    }
    if (result.status !== 'ok' && !isCurrentView(request)) {
      if (result.status === 'tan' || result.status === 'tanPending') await cancelSession(result.sessionId)
      endFlow(request)
      return
    }
    switch (result.status) {
      case 'needPin':
        setFlow({ account, request, pin, savePin, modal: { kind: 'pin' } })
        return
      case 'tan':
      case 'tanPending':
        activeRequest.current = { ...request, sessionId: result.sessionId }
        setFlow({
          account,
          request: activeRequest.current,
          pin,
          savePin,
          modal: { kind: 'tan', sessionId: result.sessionId, challenge: result.challenge, decoupled: result.decoupled },
        })
        return
      case 'chooseAccount':
        if (result.accounts.length === 1) {
          await chooseAccount(account, request, result.accounts[0], pin, savePin)
        } else {
          setFlow({ account, request, pin, savePin, modal: { kind: 'chooseAccount', accounts: result.accounts } })
        }
        return
      case 'ok':
        await applyRows(account, request, result.rows)
        endFlow(request)
        if (result.pinSaveFailed && isCurrentView(request)) setError('Die PIN konnte auf diesem Gerät nicht gespeichert werden.')
        return
      case 'error':
        endFlow(request)
        setError(result.message)
        return
    }
  }

  async function continueWithTan(sessionId: string, tan?: string) {
    if (continuing.current || !flow) return
    continuing.current = true
    try {
      const result = (await api.bankContinue(sessionId, tan)) as BankFetchResult
      await handleResult(flow.account, flow.request, result, flow.pin, flow.savePin)
    } catch (failure) {
      endFlow(flow.request)
      if (isCurrentView(flow.request)) setError(failure instanceof Error ? failure.message : 'Die Bankfreigabe ist fehlgeschlagen.')
    } finally {
      continuing.current = false
    }
  }

  async function chooseAccount(
    account: BankAccountConfig,
    request: FetchRequest,
    choice: BankAccountChoice,
    pin?: string,
    savePin = false,
  ) {
    if (!isCurrentView(request) || cancelledRequests.current.has(request.id)) return
    const current = latestAccounts.current.find((entry) => entry.id === account.id && (entry.konto ?? 'haupt') === request.target.konto)
    if (!current) { endFlow(request); return }
    const withNumber = { ...current, accountNumber: choice.accountNumber, iban: choice.iban }
    await updateSettings({
      bankAccounts: latestAccounts.current.map((a) => (a.id === account.id ? withNumber : a)),
    })
    if (isCurrentView(request) && !cancelledRequests.current.has(request.id)) await beginFetch(withNumber, pin, savePin, request)
  }

  async function applyRows(account: BankAccountConfig, request: FetchRequest, rows: BankFetchedRow[]) {
    if (rows.length === 0) {
      if (isCurrentView(request)) onFetchResult('Die Bank hat für den gewählten Zeitraum keine Umsätze gemeldet.')
      return
    }
    const statementRows: StatementRow[] = rows.map((r) => ({
      ...r,
      hash: rowHash(r.date, r.amount, r.description),
      legacyHashes: legacyRowHashes(r.date, r.amount, r.description),
    }))
    const sourceName = `${account.label} · Abruf vom ${formatDate(new Date().toISOString().slice(0, 10))}`
    const imported: { result?: ReturnType<typeof mergeImportResponse> } = {}
    await updateAccount(request.target.konto, request.target.year, (current) => {
      if (cancelledRequests.current.has(request.id)) return current
      imported.result = mergeImportResponse(current, statementRows, sourceName, 0)
      return imported.result.file
    }, account.id)
    if (!imported.result) return
    const { freshCount, messages } = imported.result
    const extra = messages.length > 0 ? ` ${messages.join(', ')}.` : ''
    onFetchResult(freshCount > 0
      ? `${freshCount} neue Umsätze abgerufen – unten zuweisen und übernehmen.${extra}`
      : `Keine neuen Umsätze vorhanden.${extra}`)
  }

  async function cancelFlow() {
    const request = activeRequest.current
    if (!request) return
    cancelledRequests.current = new Set([...cancelledRequests.current, request.id])
    if (request.sessionId) await cancelSession(request.sessionId)
    endFlow(request)
  }

  async function removeAccount(account: BankAccountConfig) {
    if (!confirm(`Bankkonto „${account.label}" wirklich entfernen? Gespeicherte PIN und Bankdaten werden gelöscht.`)) {
      return
    }
    await api.bankForget(account.id)
    await updateSettings({ bankAccounts: accounts.filter((a) => a.id !== account.id) })
    setError('')
  }

  async function saveAccount(draft: BankAccountConfig) {
    const withKonto = { ...draft, konto: bankKonto }
    const next = isNew ? [...accounts, withKonto] : accounts.map((a) => (a.id === draft.id ? withKonto : a))
    await updateSettings({ bankAccounts: next })
    setEditing(null)
    setError('')
  }

  return (
    <>
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
              Die PIN kannst du verschlüsselt auf diesem Gerät speichern.
            </p>
            <button
              className="btn btn--primary"
              onClick={() => {
                setIsNew(true)
                setEditing({ id: makeId(), konto: bankKonto, label: '', blz: '', fintsUrl: '', userId: '' })
              }}
            >
              Bankverbindung einrichten
            </button>
          </div>
        )}

        {account && (
          <div className="table-scroll"><table className="ledger">
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
                      void beginFetch(account)
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
          </table></div>
        )}

        {account && isElectron && <BankPinSettings key={account.id} account={account} busy={busyId !== null || editing !== null}
          onReenter={() => enterPin(account)} />}

        {error && (
          <p className="hint split-editor__error" role="alert" style={{ marginTop: 'var(--space-3)' }}>
            {error}
          </p>
        )}
      </section>

      {editing && (
        <AccountForm
          account={editing}
          isNew={isNew}
          onSave={(a) => void saveAccount(a)}
          onCancel={() => setEditing(null)}
        />
      )}

      {flow?.modal?.kind === 'pin' && (
        <PinModal
          account={flow.account}
          onSubmit={(pin, savePin) => void beginFetch(flow.account, pin, savePin, flow.request)}
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
          onChoose={(choice) => void chooseAccount(flow.account, flow.request, choice, flow.pin, flow.savePin)}
          onCancel={() => void cancelFlow()}
        />
      )}
    </>
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
  const [addressTouched, setAddressTouched] = useState(false)
  const normalized = normalize(draft)
  const errors = validateBankAccountConfig(normalized)
  const addressError = addressTouched && draft.fintsUrl.trim()
    ? errors.find((message) => message.startsWith('Die FinTS-Adresse'))
    : undefined

  return (
    <section className="card">
      <h2 className="card__title">{isNew ? 'Bankkonto hinzufügen' : `Bankkonto bearbeiten: ${account.label}`}</h2>
      <div className="account-settings-fields">
        <label className="field">
          Anzeigename
          <input
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            placeholder="z. B. Hauptkonto Volksbank"
            autoFocus
          />
        </label>
        <label className="field">
          Bankleitzahl
          <input
            value={draft.blz}
            onChange={(e) => setDraft({ ...draft, blz: e.target.value.replace(/\s/g, '') })}
            placeholder="8-stellige Bankleitzahl"
            inputMode="numeric"
          />
        </label>
        <label className="field">
          VR-NetKey / Anmeldename
          <input
            value={draft.userId}
            onChange={(e) => setDraft({ ...draft, userId: e.target.value })}
            placeholder="Anmeldename im Online-Banking"
          />
        </label>
        <label className="field bank-account-address">
          FinTS-Zugangsadresse
          <input
            type="url"
            value={draft.fintsUrl}
            onChange={(e) => setDraft({ ...draft, fintsUrl: e.target.value })}
            onBlur={() => setAddressTouched(true)}
            list="fints-url-suggestions"
            placeholder="https://…"
            aria-invalid={addressError ? true : undefined}
            aria-describedby={addressError ? 'bank-address-error' : undefined}
          />
          <datalist id="fints-url-suggestions">
            {FINTS_URL_SUGGESTIONS.map((s) => (
              <option key={s.url} value={s.url}>
                {s.label}
              </option>
            ))}
          </datalist>
        </label>
        {addressError && <p className="bank-account-address hint split-editor__error" id="bank-address-error">{addressError}</p>}
      </div>
      <p className="hint">
        Die PIN wird beim ersten Abruf abgefragt und auf Wunsch verschlüsselt auf diesem Gerät gespeichert.
      </p>
      <div className="toolbar">
        <div className="toolbar__spacer" />
        <button className="btn btn--ghost" onClick={onCancel}>
          Abbrechen
        </button>
        <button className="btn btn--primary" disabled={errors.length > 0} onClick={() => onSave(normalized)}>
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
  const [savePin, setSavePin] = useState(false)

  return (
    <BankDialog label="PIN eingeben" onCancel={onCancel}>
      <form onSubmit={(event) => { event.preventDefault(); if (pin.trim()) onSubmit(pin.trim(), savePin) }}>
        <h3>PIN für {account.label}</h3>
        <label>
          Online-Banking-PIN
          <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} aria-label="PIN"
            autoComplete="off" maxLength={1024} autoFocus />
        </label>
        <label className="checkrow">
          <input type="checkbox" checked={savePin} onChange={(e) => setSavePin(e.target.checked)} />
          PIN auf diesem Gerät speichern
        </label>
        <div className="bank-pin-actions">
          <button type="button" className="btn" onClick={onCancel}>
            Abbrechen
          </button>
          <button type="submit" className="btn btn--primary" disabled={!pin.trim()}>
            Abrufen
          </button>
        </div>
      </form>
    </BankDialog>
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
