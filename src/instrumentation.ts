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
//
// Sentry added 2026-07-10 (46-tool sweep, docs/infra/TOOL_INTEGRATION_PLAN.md
// §6): captured ALONGSIDE the existing applicationErrors DB write below, not
// instead of it -- Sentry gives live alerting/stack-trace grouping that a
// plain DB table can't, but the DB write stays as the zero-dependency
// fallback (matters if SENTRY_DSN is ever unset/misconfigured). Sentry.init
// with an undefined dsn safely no-ops, so this whole file behaves exactly as
// before until a real SENTRY_DSN secret is added.
import type { Instrumentation } from "next"
import * as Sentry from "@sentry/nextjs"

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config")
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config")
  }
  // V2-10: surface a missing SENTRY_DSN / NEXT_PUBLIC_SENTRY_DSN at startup
  // so a deploy without the secret is *observable* in the log stream --
  // Sentry.init already no-ops on an undefined dsn, this just makes that
  // no-op loud instead of silent. Runs in every runtime Next loads this
  // file for (nodejs + edge); the check is pure env inspection, no SDK
  // call. See src/lib/sentry-dsn-check.ts for the rationale.
  const { warnIfSentryDsnMissing } = await import("./lib/sentry-dsn-check")
  warnIfSentryDsnMissing()
}

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  Sentry.captureRequestError(err, request, context)
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
