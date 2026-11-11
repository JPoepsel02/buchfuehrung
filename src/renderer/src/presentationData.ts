import { byCategory, yearTotals } from '@shared/ledger'
import { fiscalLabel, fiscalRange, fiscalStartMonth } from '@shared/fiscal'
import { monthOf } from '@shared/money'
import type { Category, YearFile } from '@shared/types'

export interface PresentationStation {
  month: number
  name: string
  saldo: number
  firstDate: string
}

export interface PresentationSummary { name: string; saldo: number }

export function praesentationsModus(category: Category): 'monat' | 'sammel' | 'aus' {
  return category.praesentation ?? (/sonstig|beitr[aä]g|zusch[uü]ss|spende/i.test(category.name) ? 'sammel' : 'monat')
}

function balancedChunks<T>(items: T[]): T[][] {
  const count = Math.max(1, Math.ceil(items.length / 4))
  const base = Math.floor(items.length / count)
  const extra = items.length % count
  return Array.from({ length: count }, (_, index) => {
    const start = index * base + Math.min(index, extra)
    return items.slice(start, start + base + (index < extra ? 1 : 0))
  }).filter((chunk) => chunk.length > 0)
}

export function buildPresentationData(file: YearFile) {
  const groups = byCategory(file)
  const firstMonth = fiscalStartMonth(file)
  const stations: PresentationStation[] = groups.filter((group) => praesentationsModus(group.category) === 'monat')
    .map((group) => ({
      month: group.category.praesentationMonat ?? monthOf(group.rows[0].date), name: group.category.name,
      saldo: group.saldo, firstDate: group.rows[0].date,
    }))
    .sort((left, right) => ((left.month - firstMonth + 12) % 12) - ((right.month - firstMonth + 12) % 12)
      || left.firstDate.localeCompare(right.firstDate))
  const summaries: PresentationSummary[] = groups.filter((group) => praesentationsModus(group.category) === 'sammel')
    .map((group) => ({ name: group.category.name, saldo: group.saldo }))
  return { timeline: balancedChunks(stations), summaries: balancedChunks(summaries),
    totals: yearTotals(file), range: fiscalRange(file), label: fiscalLabel(file) }
}
