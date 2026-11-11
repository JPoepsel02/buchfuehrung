import type { AppSettings, KontoId, YearFile } from '@shared/types'

export function usedKontoSequence(existing: readonly KontoId[], settings: AppSettings): number {
  const references = [
    ...existing, ...Object.keys(settings.accountNumbers ?? {}),
    ...(settings.bankAccounts ?? []).map((entry) => entry.konto ?? 'haupt'),
    ...(settings.organization?.rules ?? []).map((entry) => entry.konto),
    ...(settings.organization?.transfers ?? []).flatMap((entry) => [entry.from.konto, entry.to.konto]),
    ...Object.keys(settings.organization?.assignments ?? {}).flatMap((key) => {
      try { const parts: unknown = JSON.parse(key); return Array.isArray(parts) && typeof parts[0] === 'string' ? [parts[0]] : [] }
      catch { return [] }
    }),
  ]
  return references.reduce((highest, id) => Math.max(highest, id === 'zweit' ? 2 : /^k\d+$/.test(id) ? Number(id.slice(1)) : 1), settings.kontoSequence ?? 1)
}

export function nextKontoIdentity(existing: readonly KontoId[], settings: AppSettings): { id: KontoId; sequence: number } {
  const sequence = usedKontoSequence(existing, settings) + 1
  if (!Number.isSafeInteger(sequence)) throw new Error('Es kann keine weitere Konto-Kennung vergeben werden.')
  return { id: sequence === 2 ? 'zweit' : `k${sequence}`, sequence }
}

export function assertNewYear(files: readonly YearFile[], konto: KontoId, year: number): void {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error('Das Kassenjahr muss zwischen 2000 und 2100 liegen.')
  if (files.some((file) => (file.konto ?? 'haupt') === konto && file.year === year)) {
    throw new Error('Dieses Kassenjahr ist bereits vorhanden. Bitte das vorhandene Kassenjahr öffnen.')
  }
}
