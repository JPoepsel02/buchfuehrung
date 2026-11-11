import { useEffect, useId, useState } from 'react'
import { AREA_DEFINITIONS, allocationError } from '@shared/organization'
import type { ActivityAllocation, ActivityAreaId } from '@shared/organization'
import { formatAmount, formatEur, parseAmountToCents } from '@shared/money'
import { AmountField } from './AmountInput'
import { Icon } from './Icon'

interface Props {
  amount: number
  value: ActivityAllocation[]
  onChange(value: ActivityAllocation[]): void
  suggestedArea?: ActivityAreaId
  disabled?: boolean
}

export function ActivityAllocationEditor({ amount, value, onChange, suggestedArea, disabled = false }: Props) {
  const id = useId()
  const [rawAmounts, setRawAmounts] = useState<string[]>(() => value.map((part) => formatAmount(part.amount)))
  const total = value.reduce((sum, part) => sum + part.amount, 0)
  const error = value.length > 0 ? allocationError(amount, value) : null

  useEffect(() => {
    setRawAmounts((current) => value.map((part, index) => {
      const raw = current[index]
      if (raw !== undefined && (parseAmountToCents(raw) ?? 0) === part.amount) return raw
      return formatAmount(part.amount)
    }))
  }, [value])

  function changeAmount(index: number, raw: string) {
    setRawAmounts((current) => value.map((part, i) => i === index ? raw : current[i] ?? formatAmount(part.amount)))
    onChange(value.map((part, i) => i === index ? { ...part, amount: parseAmountToCents(raw) ?? 0 } : part))
  }

  function addPart() {
    const nextArea = AREA_DEFINITIONS.find((area) => !value.some((part) => part.area === area.id))
    if (!nextArea) return
    onChange([...value, { area: nextArea.id, amount: Math.max(0, amount - total) }])
  }

  return (
    <fieldset className="org-allocation-editor" disabled={disabled} aria-describedby={`${id}-sum${error ? ` ${id}-error` : ''}`}>
      <legend>Tätigkeitsbereich</legend>
      {value.length === 0 && (
        <div className="org-allocation-empty">
          <label className="field">
            <span>Bereich</span>
            <select aria-label="Tätigkeitsbereich auswählen" value="" onChange={(event) => onChange([{ area: event.target.value as ActivityAreaId, amount }])}>
              <option value="">Noch nicht zugeordnet</option>
              {AREA_DEFINITIONS.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
            </select>
          </label>
          {suggestedArea && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => onChange([{ area: suggestedArea, amount }])}>
              Vorschlag übernehmen: {AREA_DEFINITIONS.find((area) => area.id === suggestedArea)?.name}
            </button>
          )}
        </div>
      )}
      {value.map((part, index) => (
        <div className="org-allocation-row" key={index}>
          <label className="field">
            <span>{value.length > 1 ? `Bereich ${index + 1}` : 'Bereich'}</span>
            <select aria-label={`Tätigkeitsbereich ${index + 1}`} value={part.area} onChange={(event) => onChange(value.map((entry, i) => i === index ? { ...entry, area: event.target.value as ActivityAreaId } : entry))}>
              {AREA_DEFINITIONS.map((area) => <option key={area.id} value={area.id} disabled={value.some((entry, i) => i !== index && entry.area === area.id)}>{area.name}</option>)}
            </select>
          </label>
          <label className="field org-allocation-amount">
            <span>Betrag in €</span>
            <AmountField value={rawAmounts[index] ?? formatAmount(part.amount)} onChange={(raw) => changeAmount(index, raw)} aria-label={`Teilbetrag ${index + 1} in Euro`} invalid={part.amount <= 0} />
          </label>
          <button type="button" className="icon-button" aria-label={`Bereich ${index + 1} entfernen`} onClick={() => onChange(value.filter((_, i) => i !== index))}>
            <Icon name="close" size={16} />
          </button>
        </div>
      ))}
      <div className="org-allocation-actions">
        {value.length > 0 && value.length < AREA_DEFINITIONS.length && <button type="button" className="btn btn--ghost btn--sm" onClick={addPart}><Icon name="plus" size={15} />Aufteilen</button>}
        <span className="hint org-allocation-sum" id={`${id}-sum`}>{formatEur(total)} / {formatEur(amount)}</span>
      </div>
      {error && <p className="org-error" id={`${id}-error`} role="status">{error}</p>}
    </fieldset>
  )
}
