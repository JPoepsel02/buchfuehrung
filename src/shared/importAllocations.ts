import { importSelectedRowsDetailed } from './importDraft'
import { bookingKey, categoryAllocations, makeAssignment } from './organization'
import type { OrganizationConfig } from './organization'
import type { YearFile } from './types'

export function importDraftWithAssignments(file: YearFile, organization: OrganizationConfig): {
  file: YearFile
  organization: OrganizationConfig
  importedCount: number
} {
  const result = importSelectedRowsDetailed(file)
  if (!result.added.length) return { file: result.file, organization, importedCount: 0 }
  const additions = Object.fromEntries(result.added.flatMap(({ booking, allocations }) => {
    const selected = allocations ?? categoryAllocations(organization, file.konto ?? 'haupt', booking.categoryId, booking.amount)
    if (!selected.length) return []
    const key = bookingKey({ konto: file.konto ?? 'haupt', year: file.year, bookingId: booking.id })
    if (Object.prototype.hasOwnProperty.call(organization.assignments, key)) throw new Error('Eine neue Buchungs-ID ist bereits vergeben. Bitte erneut importieren.')
    return [[key, makeAssignment(booking, selected)]]
  }))
  return {
    file: result.file,
    organization: Object.keys(additions).length ? { ...organization, assignments: { ...organization.assignments, ...additions } } : organization,
    importedCount: result.added.length,
  }
}
