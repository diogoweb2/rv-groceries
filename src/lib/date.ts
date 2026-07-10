/**
 * Today as `YYYY-MM-DD` in the device's own timezone.
 *
 * `new Date().toISOString()` converts to UTC first, so west of Greenwich it
 * rolls over to tomorrow in the evening — trips would advance a status, drop
 * off Home, or read "starts today" hours early. All `YYYY-MM-DD` comparisons
 * against trip dates go through this.
 */
export function localToday(): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}
