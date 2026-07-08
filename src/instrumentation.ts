// Gap closure, 2026-07-09 (AUDIT_2026-07-09.md, Logging & Monitoring
// section). No APM/error-tracking service exists anywhere in this
// codebase -- 527 files' worth of console.error() disappear into Vercel's
// ephemeral log retention with no alerting, aggregation, or historical
// query capability. Next.js's built-in onRequestError hook is the
// pragmatic first step given the real constraints (no dedicated ops
// budget, Vercel+Supabase-only infra): catches every unhandled
// server-side error centrally and writes to compliance.application_errors
// (see schema.ts) -- zero new external vendor dependency.
//
// Deliberately best-effort: a failure writing the error record must never
// throw again (that would make error *reporting* itself a source of
// errors) and this file must not import anything Edge-incompatible at
// module scope, since Next.js loads instrumentation.ts for every runtime.
import type { Instrumentation } from "next"

export const onRequestError: Instrumentation.onRequestError = async (err, request) => {
  try {
    // Dynamic import so a DB-import failure in an Edge context (e.g. the
    // MCP route, which deliberately runs on Edge and doesn't have Node's
    // postgres.js driver available) can't crash instrumentation itself --
    // it just means that specific error report is silently dropped, same
    // fail-safe posture as every other best-effort write in this codebase.
    const { db, applicationErrors } = await import("@/lib/db")
    const isError = err instanceof Error
    const message = isError ? err.message : String(err)
    const stack = isError ? err.stack : undefined
    const digestId = isError && "digest" in err && typeof (err as { digest?: unknown }).digest === "string" ? (err as { digest: string }).digest : null
    await db.insert(applicationErrors).values({
      route: request.path,
      message: message.slice(0, 2000),
      stack: stack?.slice(0, 4000),
      digestId,
    })
  } catch {
    // Never let error *reporting* itself throw -- console.error remains
    // the fallback, exactly as before this hook existed.
    console.error("instrumentation.ts: failed to record application error", err)
  }
}
