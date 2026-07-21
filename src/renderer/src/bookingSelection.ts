export interface BookingSelectionFilter {
  categoryId: string
  amount: number | null
  subcategory: string
}

interface FilterableBooking {
  categoryId: string
  amount: number
  subcategory?: string
}

export function bookingMatchesSelectionFilter(
  booking: FilterableBooking,
  filter: BookingSelectionFilter,
): boolean {
  if (filter.categoryId && booking.categoryId !== filter.categoryId) return false
  if (filter.amount !== null && booking.amount !== filter.amount) return false
  const subcategory = filter.subcategory.trim().toLocaleLowerCase('de')
  if (subcategory && (booking.subcategory ?? '').trim().toLocaleLowerCase('de') !== subcategory) {
    return false
  }
  return true
}

export function selectBookingRange(
  current: ReadonlySet<string>,
  orderedIds: readonly string[],
  anchorId: string | null,
  targetId: string,
  checked: boolean,
): ReadonlySet<string> {
  const next = new Set(current)
  const anchorIndex = anchorId ? orderedIds.indexOf(anchorId) : -1
  const targetIndex = orderedIds.indexOf(targetId)
  if (targetIndex < 0) return next

  const ids = anchorIndex < 0
    ? [targetId]
    : orderedIds.slice(Math.min(anchorIndex, targetIndex), Math.max(anchorIndex, targetIndex) + 1)
  for (const id of ids) {
    if (checked) next.add(id)
    else next.delete(id)
  }
  return next
}
