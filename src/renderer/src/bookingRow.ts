const INTERACTIVE_ROW_TARGETS = 'button, input, label, a, select, textarea'

export function shouldStartBookingEdit(target: { closest(selector: string): unknown }): boolean {
  return !target.closest(INTERACTIVE_ROW_TARGETS)
}
