export function receiptAvailableForImport(row: { receiptAvailable?: boolean }): boolean {
  return row.receiptAvailable === true
}
