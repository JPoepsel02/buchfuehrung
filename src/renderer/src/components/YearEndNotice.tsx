import { useId } from 'react'
import { fiscalEndLabel, fiscalLabel } from '@shared/fiscal'
import type { YearFile } from '@shared/types'
import type { KontoInfo } from '../store'
import { Icon } from './Icon'

export function YearEndNotice({ years, accounts, onOpen }: {
  years: readonly YearFile[]
  accounts: readonly KontoInfo[]
  onOpen: (year: YearFile) => void
}) {
  const titleId = useId()
  if (years.length === 0) return null

  return <section className="year-end-notice" aria-labelledby={titleId}>
    <h2 id={titleId}><Icon name="calendar" size={18} />{years.length === 1 ? 'Jahresabschluss fällig' : 'Jahresabschlüsse fällig'}</h2>
    <ul>
      {years.map((year) => {
        const konto = year.konto ?? 'haupt'
        const name = accounts.find((account) => account.id === konto)?.name ?? 'Konto'
        return <li key={konto}>
          <span><strong>{name}</strong> · Kassenjahr {fiscalLabel(year)} endete am {fiscalEndLabel(year)}.</span>
          <button type="button" className="btn" aria-label={`Zum Jahresabschluss für ${name}`} onClick={() => onOpen(year)}>
            Zum Jahresabschluss <Icon name="arrow" size={15} />
          </button>
        </li>
      })}
    </ul>
  </section>
}
