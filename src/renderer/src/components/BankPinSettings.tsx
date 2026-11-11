import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { BankPinStatus } from '@shared/bank'
import type { BankAccountConfig } from '@shared/types'
import { api } from '../api'
import '../styles/bankPin.css'

const statusLabel = {
  saved: 'PIN gespeichert',
  unusable: 'Gespeicherte PIN nicht verwendbar',
  missing: 'Keine PIN gespeichert',
}

export function BankPinSettings({ account, busy, onReenter }: {
  account: BankAccountConfig
  busy: boolean
  onReenter(): void
}) {
  const [status, setStatus] = useState<BankPinStatus>()
  const [checkingFailed, setCheckingFailed] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const reenter = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (busy) return
    let active = true
    void api.bankPinStatus(account.id).then((value) => {
      if (active) { setStatus(value); setCheckingFailed(false) }
    }, () => {
      if (active) { setStatus(undefined); setCheckingFailed(true) }
    })
    return () => { active = false }
  }, [account, busy])

  async function removePin() {
    setDeleting(true)
    setError('')
    try {
      await api.bankPinDelete(account.id)
      setStatus('missing')
      setCheckingFailed(false)
      setConfirming(false)
      requestAnimationFrame(() => reenter.current?.focus())
    } catch {
      setError('Die gespeicherte PIN konnte nicht entfernt werden.')
    } finally {
      setDeleting(false)
    }
  }

  return <>
    <div className="bank-pin-settings">
      <div>
        <strong>Online-Banking-PIN</strong>
        <p className="hint" role="status">{status ? statusLabel[status] : checkingFailed
          ? 'PIN-Status konnte nicht geprüft werden' : 'PIN-Status wird geprüft …'}</p>
      </div>
      <div className="bank-pin-actions">
        <button ref={reenter} className="btn" disabled={busy} onClick={onReenter}>PIN erneut eingeben</button>
        <button className="btn btn--ghost btn--danger" disabled={busy || (!checkingFailed && (!status || status === 'missing'))}
          onClick={() => { setError(''); setConfirming(true) }}>Gespeicherte PIN entfernen</button>
      </div>
    </div>
    {confirming && <BankDialog label="Gespeicherte PIN entfernen" onCancel={() => { if (!deleting) setConfirming(false) }}>
      <h3>Gespeicherte PIN entfernen?</h3>
      <p className="hint">Beim nächsten Abruf für „{account.label}“ wird die PIN wieder abgefragt.</p>
      {error && <p className="org-error" role="alert">{error}</p>}
      <div className="bank-pin-actions">
        <button className="btn" disabled={deleting} onClick={() => setConfirming(false)}>Abbrechen</button>
        <button className="btn btn--danger" disabled={deleting} onClick={() => void removePin()}>
          {deleting ? 'PIN wird entfernt …' : 'PIN entfernen'}
        </button>
      </div>
    </BankDialog>}
  </>
}

export function BankDialog({ label, onCancel, children }: { label: string; onCancel(): void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])

  return <dialog className="modal-panel bank-pin-dialog" ref={dialog} aria-label={label}
    onCancel={(event) => { event.preventDefault(); onCancel() }}>{children}</dialog>
}
