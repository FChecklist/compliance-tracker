import { NextResponse } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { readAppRuntimePoolHealth } from "@/lib/db/tenant-scoped"

// R67 F-16 (R-233): the pool probe.
//
// On 2026-09-02 all five app_runtime connections sat "idle in transaction" for
// 25 minutes and every PROJEXA page 504'd. The only way anyone could see that
// was to open a Supabase SQL session by hand and run pg_stat_activity -- i.e.
// the evidence existed only for someone who already suspected the cause. This
// makes the janitor query a permanent, checkable endpoint.
//
// WHY IT IS NOT A CRON-SECRET ROUTE like its /api/internal/* siblings. Those
// are server-to-server jobs with no human on the other end. This one is read by
// a person during an incident, so it is gated the way the rest of the
// operator-facing surface is: a real session, admin or higher. It exposes no
// tenant data at all -- it counts this application's own database sessions --
// but it does describe the deployment's internals, so it is never public.
//
// Deliberately no `revalidate`/caching of any kind: a cached pool reading is a
// wrong pool reading, and the single question this endpoint answers is "what is
// happening right now".
export const dynamic = "force-dynamic"

export async function GET() {
  const { response, dbUser } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "admin")
  if (roleErr) return roleErr

  try {
    const pool = await readAppRuntimePoolHealth()

    // A flat, quotable verdict so an operator does not have to interpret the
    // counts under pressure.
    //
    // "saturated" is the shape of the real incident: enough sessions parked in
    // a transaction that is running no query to occupy the whole client-side
    // pool. It is keyed on idleInTransaction, NOT on `total` -- through
    // Supabase's transaction pooler `total` counts every instance's sessions
    // and routinely exceeds one instance's max, which would make a `total`-based
    // verdict cry wolf on a perfectly healthy deployment.
    //
    // "net_not_reaching" is worse than saturated and must not be hidden behind
    // it: a session that has been idle in a transaction for materially longer
    // than the 30 s timeout means the safety net is not being applied to it at
    // all (a pooler-side session, or the setting lost), which is the one state
    // where nothing will recover on its own.
    const oldest = pool.oldestIdleInTransactionSeconds
    const timeoutSeconds = pool.idleInTransactionTimeoutMs / 1000
    const status =
      oldest !== null && oldest > timeoutSeconds * 2
        ? "net_not_reaching"
        : pool.idleInTransaction >= pool.maxPoolSize
          ? "saturated"
          : pool.idleInTransaction > 0
            ? "idle_in_transaction_present"
            : "healthy"

    return NextResponse.json({ status, pool })
  } catch (error) {
    console.error("Pool health probe error:", error)
    return NextResponse.json({ error: "Failed to read app_runtime pool health" }, { status: 500 })
  }
}
