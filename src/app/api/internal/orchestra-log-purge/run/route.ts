import { NextRequest, NextResponse } from "next/server"
import { db, applicationErrors } from "@/lib/db"
import { purgeExpiredOrchestraPayloads, DEFAULT_ORCHESTRA_PAYLOAD_RETENTION_DAYS } from "@/lib/orchestra-execution-logger"

// VERIDIAN Review Framework gap-closure (2026-07-18), "Audit Trail" finding:
// full prompt/response text has no expiry today -- this is the scheduled
// consequence of orchestra-execution-logger.ts's purgeExpiredOrchestraPayloads().
// Same shared-secret cron pattern as its siblings (secrets-audit, loops,
// instruction-audit) -- see secrets-audit/run/route.ts's isAuthorized() for
// why an empty CRON_SECRET must fail closed, not open.
// ORCHESTRA_PAYLOAD_RETENTION_DAYS is optional -- unset falls back to the
// module's own DEFAULT_ORCHESTRA_PAYLOAD_RETENTION_DAYS (90).

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return request.headers.get("authorization") === `Bearer ${secret}`
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  try {
    const envRetention = Number(process.env.ORCHESTRA_PAYLOAD_RETENTION_DAYS)
    const retentionDays = Number.isFinite(envRetention) && envRetention > 0 ? envRetention : DEFAULT_ORCHESTRA_PAYLOAD_RETENTION_DAYS
    const result = await purgeExpiredOrchestraPayloads(retentionDays)
    return NextResponse.json({ ranAt: new Date().toISOString(), ...result })
  } catch (error) {
    console.error("Orchestra log purge run failed:", error)
    await db.insert(applicationErrors).values({
      route: "internal/orchestra-log-purge",
      message: error instanceof Error ? error.message : String(error),
    }).catch(() => {})
    return NextResponse.json({ error: "Orchestra log purge run failed" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
