import { NextRequest, NextResponse } from "next/server"
import { db, applicationErrors } from "@/lib/db"

/**
 * Gap closure, 2026-07-09 (AUDIT_2026-07-09.md, Logging & Monitoring
 * section). The CRON_SECRET incident's specific symptom (silent,
 * fail-closed 401 on every cron route) cannot recur in exactly that form
 * again -- confirmed every internal cron route's isAuthorized() already
 * treats an empty secret as unauthorized rather than an open door. But the
 * *detection* problem was unsolved and generalizes: GROQ_API_KEY had the
 * identical root pattern (a separate, real, previously-found incident), and
 * nothing existed that would catch a third instance for any other secret.
 * This is that catch -- a scheduled check of every var this app is known to
 * depend on, following the exact same shared-secret cron pattern as its
 * 5 siblings.
 *
 * NOTE: this list is a starting point grounded in this session's own
 * established knowledge of what's load-bearing (CLAUDE.md's "Env Vars
 * Required" section + the cron/DB/crypto vars this codebase's own docs
 * name as critical) -- it is deliberately NOT claimed to be exhaustive.
 * Extend it as new load-bearing secrets are introduced.
 */
const REQUIRED_ENV_VARS = [
  "CRON_SECRET",
  "DATABASE_URL",
  "APP_RUNTIME_DATABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "AI_CONFIG_ENCRYPTION_KEY",
]

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
    const missing = REQUIRED_ENV_VARS.filter((name) => !process.env[name])

    if (missing.length > 0) {
      const message = `Secrets audit: ${missing.length} required env var(s) missing in production: ${missing.join(", ")}`
      console.error(message)
      // Best-effort record into the same central log instrumentation.ts
      // writes to, so a missing secret shows up alongside every other
      // application error rather than only in a cron's own transient
      // response body.
      await db.insert(applicationErrors).values({
        route: "internal/secrets-audit",
        message,
      }).catch(() => {})
    }

    return NextResponse.json({ ranAt: new Date().toISOString(), checked: REQUIRED_ENV_VARS.length, missing })
  } catch (error) {
    console.error("Secrets audit run failed:", error)
    return NextResponse.json({ error: "Secrets audit run failed" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
