import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { isElectron } from '../api'
import { DataStorageCard, LogoCard, UpdateCard } from './EinstellungenView'
import type { ThemeSetting } from '@shared/types'

export function OrganizationSettingsView() {
  const { organization, updateOrganization, settings, updateSettings, kontos, startKontoSetup } = useStore()
  const [name, setName] = useState(organization.name)
  const [treasurerName, setTreasurerName] = useState(organization.treasurerName)
  const [productId, setProductId] = useState(settings.fintsProductId ?? '')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setName(organization.name)
    setTreasurerName(organization.treasurerName)
  }, [organization.name, organization.treasurerName])
  useEffect(() => setProductId(settings.fintsProductId ?? ''), [settings.fintsProductId])

  function notify(text: string) {
    setMessage(text)
    setError('')
  }

  async function perform(task: () => Promise<void>, success: string) {
    setSaving(true)
    setError('')
    setMessage('')
    try {
      await task()
      setMessage(success)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setSaving(false)
    }
  }

  function saveOrganization(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim()) return setError('Vereinsname angeben.')
    void perform(() => updateOrganization({ name: name.trim(), treasurerName: treasurerName.trim() }), 'Vereinsdaten gespeichert.')
  }

  return (
    <div className="view org-settings">
      <header className="view__header"><h1 className="view__title">Gemeinsame Einstellungen</h1></header>
      {error && <p role="alert" className="org-error">{error}</p>}
      {message && <p role="status" className="org-status">{message}</p>}
      <form className="card" onSubmit={saveOrganization}>
        <h2 className="card__title">Vereinsdaten</h2>
        <div className="form-grid">
          <div className="field" style={{ gridColumn: 'span 6' }}>
            <label htmlFor="org-name">Vereinsname</label>
            <input id="org-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={160} required />
          </div>
          <div className="field" style={{ gridColumn: 'span 6' }}>
            <label htmlFor="org-treasurer">Kassenwart:in</label>
            <input id="org-treasurer" value={treasurerName} onChange={(event) => setTreasurerName(event.target.value)} maxLength={160} />
          </div>
        </div>
        <div className="toolbar" style={{ marginTop: 16 }}><button className="btn btn--primary" disabled={saving} type="submit">Speichern</button></div>
      </form>

      <section className="card">
        <h2 className="card__title">Darstellung</h2>
        <div className="field" style={{ maxWidth: 280 }}>
          <label htmlFor="org-theme">Farbschema</label>
          <select id="org-theme" value={settings.theme ?? 'system'} disabled={saving}
            onChange={(event) => {
              const theme = event.target.value as ThemeSetting
              void perform(() => updateSettings({ theme }), 'Darstellung gespeichert.')
            }}>
            <option value="system">System</option><option value="hell">Hell</option><option value="dunkel">Dunkel</option>
          </select>
        </div>
      </section>

      <LogoCard notify={notify} />
      <DataStorageCard notify={notify} />

      <section className="card">
        <h2 className="card__title">Konten</h2>
        <div className="toolbar">
          <span>{kontos.map((entry) => entry.name).join(' · ')}</span>
          <div className="toolbar__spacer" />
          <button className="btn" onClick={startKontoSetup}>Konto anlegen …</button>
        </div>
      </section>

      <form className="card" onSubmit={(event) => {
        event.preventDefault()
        void perform(() => updateSettings({ fintsProductId: productId.trim() || null }), 'Produktkennung gespeichert.')
      }}>
        <h2 className="card__title">Online-Banking</h2>
        <div className="field" style={{ maxWidth: 480 }}>
          <label htmlFor="org-fints-product">FinTS-Produktkennung</label>
          <input id="org-fints-product" value={productId} onChange={(event) => setProductId(event.target.value)} maxLength={128} placeholder="Standard-Kennung verwenden" />
        </div>
        <div className="toolbar" style={{ marginTop: 16 }}><button className="btn" disabled={saving} type="submit">Speichern</button></div>
      </form>
      {isElectron && <UpdateCard />}
    </div>
  )
}
