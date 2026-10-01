/** The database stores billing instants as `timestamp` (no time zone), always UTC, and some RPCs (dpdp_my_billing,
 * dpdp_owner_pending_payments) return them as "2026-10-29T08:38:15.972585" with NO zone designator. `new Date()` reads such a
 * string as the viewer's LOCAL time, so an IST viewer saw every trial/confirmation instant 5.5 hours early (a US viewer, hours
 * late). parseDbTimestamp reads a value with no zone as UTC, and leaves one that already has Z or an offset exactly as given. */
export function parseDbTimestamp(value: string): Date {
  const v = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(`${v}T00:00:00Z`)
  return new Date(/(Z|[+-]\d{2}(:?\d{2})?)$/i.test(v) ? v : `${v}Z`)
}
