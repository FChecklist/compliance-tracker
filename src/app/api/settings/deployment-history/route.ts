import { NextResponse } from "next/server"
import { desc } from "drizzle-orm"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { db, deploymentEvents } from "@/lib/db"

// Cloud Deployment / Deployment Operations gap-closure, "Deployment Audit
// Trail" finding (Low): "Webhook exists but downstream usage/dashboard for
// the recorded data not independently verified." POST
// /api/webhooks/vercel-deployment already writes real rows into
// deployment_events (schema.ts) but nothing under src/app/(app)/ ever read
// them back -- confirmed by search before writing this route. This is that
// missing simple deployment-history view's data source.
//
// Platform-level data (deployment_events has no org_id by design -- a
// Vercel deployment belongs to this app's own single Vercel project, not
// any one tenant -- see that table's own schema.ts header), so this
// intentionally does not scope by the caller's own org; admin-role gate is
// the access control, same posture as system-health/route.ts right above.
export async function GET() {
  const { response, dbUser } = await requireAuth()
  if (response) return response
  if (!dbUser || dbUser.role !== "admin") {
    return NextResponse.json({ error: "Only admins can view deployment history" }, { status: 403 })
  }

  try {
    const events = await db.query.deploymentEvents.findMany({
      orderBy: desc(deploymentEvents.receivedAt),
      limit: 25,
    })

    return NextResponse.json({
      // Whether the receiver can even authenticate a real delivery -- see
      // that route's own fail-closed check. Surfaced here so an admin looking
      // at an empty list can tell "no deployments happened yet" apart from
      // "the webhook was never actually registered/configured," which
      // MASTER-TRACKER.yaml records as still an open, disclosed item.
      receiverConfigured: Boolean(process.env.VERCEL_DEPLOYMENT_WEBHOOK_SECRET),
      events,
    })
  } catch (error) {
    console.error("Deployment history fetch error:", error)
    return NextResponse.json({ error: "Failed to load deployment history" }, { status: 500 })
  }
}
