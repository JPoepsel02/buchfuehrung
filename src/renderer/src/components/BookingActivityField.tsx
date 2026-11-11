import { AREA_DEFINITIONS } from '@shared/organization'
import type { ActivityAllocation, ActivityAreaId } from '@shared/organization'
import { ActivityAllocationEditor } from './ActivityAllocationEditor'

interface Props {
  amount: number
  value: ActivityAllocation[]
  automatic: boolean
  defaultArea?: ActivityAreaId
  transfer: boolean
  needsReview: boolean
  onChange(value: ActivityAllocation[]): void
  onUseCategory(): void
}

export function BookingActivityField({ amount, value, automatic, defaultArea, transfer, needsReview, onChange, onUseCategory }: Props) {
  return <div className="field" style={{ gridColumn: '1 / -1' }}>
    {transfer ? <>
      <label>Tätigkeitsbereich</label>
      <span className="hint">Interne Umbuchung</span>
    </> : <>
      {automatic && defaultArea && amount <= 0 ? <fieldset className="org-allocation-editor">
        <legend>Tätigkeitsbereich</legend>
        <label className="field">
          <span>Bereich</span>
          <select aria-label="Tätigkeitsbereich 1" value={defaultArea} onChange={(event) => onChange(event.target.value
            ? [{ area: event.target.value as ActivityAreaId, amount: Math.max(0, amount) }]
            : [])}>
            <option value="">Noch nicht zugeordnet</option>
            {AREA_DEFINITIONS.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
          </select>
        </label>
      </fieldset> : <ActivityAllocationEditor amount={amount} value={value} onChange={onChange} />}
      {defaultArea && !automatic && <button type="button" className="btn btn--ghost btn--sm" onClick={onUseCategory}>
        Kategorie-Vorgabe verwenden
      </button>}
      {needsReview && <span className="hint" role="status">Zuordnung prüfen</span>}
    </>}
  </div>
}
