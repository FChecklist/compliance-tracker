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
    // counts under pressure. "saturated" is the shape of the real incident:
    // every slot held, and held by a transaction that is not running a query.
    const saturated = pool.total >= pool.maxPoolSize && pool.idleInTransaction > 0
    const status = saturated ? "saturated" : pool.idleInTransaction > 0 ? "idle_in_transaction_present" : "healthy"

    return NextResponse.json({ status, pool })
  } catch (error) {
    console.error("Pool health probe error:", error)
    return NextResponse.json({ error: "Failed to read app_runtime pool health" }, { status: 500 })
  }
}
