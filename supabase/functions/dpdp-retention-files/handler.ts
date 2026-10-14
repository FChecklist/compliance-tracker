// DPDP audit-fix programme, fix 3 (2026-10-14): the daily job that removes expired payment-proof FILES. PURE apart from the injected `Deps`, so
// src/lib/services/dpdp-retention-files.test.ts drives it with fakes. index.ts is the thin Deno wrapper (bearer check, Storage API client).
//
// WHY AN EDGE FUNCTION: a file in a Supabase storage bucket cannot be removed with SQL (deleting its storage.objects row leaves the file in the storage layer), so the
// database only PLANS (dpdp_retention_proof_plan: which objects are past payment_proof_days, and whether deletion is live) and RECORDS (dpdp_retention_proof_done:
// the count goes into dpdp.retention_run next to the SQL sweep's own report, and the path is forgotten on the subscription). This function does the removal in between.
//
// BILLING RECORDS ARE KEPT: a payment proof belongs to a payment record, so the shipped setting has no period (payment_proof_days is null) and the plan is empty:
// this job removes nothing until a period is deliberately set. It also obeys the live switch (dpdp.retention_setting.live) and a dry-run request: in those cases the
// plan returns an empty name list and only the count of files past their period is written to the report.
// A file that could not be removed is NOT forgotten: its path stays, and the next day's plan lists it again.
export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>

export type Deps = {
  rpc: Rpc
  /** Removes the named objects from the private proof bucket; returns the names the Storage API confirmed removed. */
  removeFiles: (names: string[]) => Promise<{ removed: string[]; error?: string }>
}

export type Report = {
  live: boolean
  periodDays: number | null
  pastPeriod: number
  removed: number
  failed: number
  error?: string
}

const CHUNK = 100

export async function runRetentionFiles(d: Deps, opts: { dryRun?: boolean } = {}): Promise<Report> {
  const rep: Report = { live: false, periodDays: null, pastPeriod: 0, removed: 0, failed: 0 }
  const plan = await d.rpc("dpdp_retention_proof_plan", { p_force_dry_run: opts.dryRun === true })
  if (plan.error || !plan.data) {
    rep.error = "plan_failed"
    return rep
  }
  const p = plan.data as { live?: boolean; days?: number; count?: number; names?: unknown }
  rep.live = p.live === true && opts.dryRun !== true
  rep.periodDays = typeof p.days === "number" ? p.days : null
  rep.pastPeriod = Number(p.count ?? 0)
  const names = Array.isArray(p.names) ? (p.names as unknown[]).filter((n): n is string => typeof n === "string" && n.length > 0 && !n.includes("..")) : []

  const removed: string[] = []
  if (rep.live) {
    for (let i = 0; i < names.length; i += CHUNK) {
      const batch = names.slice(i, i + CHUNK)
      try {
        const out = await d.removeFiles(batch)
        const ok = new Set(out.removed.filter((n) => batch.includes(n)))
        removed.push(...ok)
        rep.failed += batch.length - ok.size
      } catch {
        rep.failed += batch.length
      }
    }
  }
  rep.removed = removed.length
  // The book is written in every case (dry run included), so a dry-run count is readable before deletion is switched on.
  const done = await d.rpc("dpdp_retention_proof_done", { p_removed: removed, p_live: rep.live, p_would_remove: rep.pastPeriod })
  if (done.error) rep.error = "record_failed"
  return rep
}
