export function receiptAvailableForImport(row: { receiptAvailable?: boolean }): boolean {
  return row.receiptAvailable === true
}

export function subcategorySuggestions(
  bookings: readonly { categoryId: string; subcategory?: string }[],
  categoryId: string,
): string[] {
  if (!categoryId) return []
  return [
    ...new Set(
      bookings
        .filter((booking) => booking.categoryId === categoryId)
        .map((booking) => (booking.subcategory ?? '').trim())
        .filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b, 'de'))
}
