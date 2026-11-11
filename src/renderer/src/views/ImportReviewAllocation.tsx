import { AREA_DEFINITIONS, allocationError, categoryAllocations } from '@shared/organization'
import type { ActivityAllocation, ActivityAreaId, OrganizationConfig } from '@shared/organization'

export function splitReviewAllocations(value: ActivityAllocation[] | undefined, total: number, first: number): [ActivityAllocation[] | undefined, ActivityAllocation[] | undefined] {
  if (value === undefined) return [undefined, undefined]
  if (value.length === 0) return [[], []]
  if (value.length === 1 && value[0].amount === total) {
    return [[{ ...value[0], amount: first }], [{ ...value[0], amount: total - first }]]
  }
  return [value.map(part => ({ ...part })), value.map(part => ({ ...part }))]
}

interface Props {
  amount: number
  categoryId: string
  value?: ActivityAllocation[]
  organization: OrganizationConfig
  konto: string
  disabled?: boolean
  label?: string
  onChange(value: ActivityAllocation[] | undefined): void
  onOpenReview(): void
}

export function ImportReviewAllocation({ amount, categoryId, value, organization, konto, disabled, label = 'Tätigkeitsbereich', onChange, onOpenReview }: Props) {
  const effective = value ?? categoryAllocations(organization, konto, categoryId, amount)
  const selected = effective.length > 1 ? 'split' : effective[0]?.area ?? ''
  const error = effective.length > 0 ? allocationError(amount, effective) : null
  return <div className="import-allocation-compact">
    <select aria-label={label} value={selected} disabled={disabled} onChange={(event) => onChange(event.target.value ? [{ area: event.target.value as ActivityAreaId, amount }] : [])}>
      <option value="">Noch offen</option>
      {AREA_DEFINITIONS.map((area) => <option value={area.id} key={area.id}>{area.name}</option>)}
      {selected === 'split' && <option value="split" disabled>Auf {effective.length} Bereiche aufgeteilt</option>}
    </select>
    <div className="import-allocation-compact__actions">
      <button type="button" className="btn btn--ghost btn--sm" disabled={disabled} onClick={onOpenReview}>{effective.length > 1 ? 'Aufteilung bearbeiten' : 'Bereich aufteilen'}</button>
      {value !== undefined && <button type="button" className="btn btn--ghost btn--sm" disabled={disabled} onClick={() => onChange(undefined)}>Vorgabe verwenden</button>}
    </div>
    {error && <span className="import-allocation-compact__error" role="status">Teilbeträge prüfen</span>}
  </div>
}
