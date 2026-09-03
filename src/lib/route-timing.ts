// R67 F-28 (audit recommendation R-249) -- Server-Timing on the VERIDIAN side
// of the PROJEXA hop.
//
// WHY THIS EXISTS. PROJEXA now stamps every one of its /api/* responses with
// `Server-Timing: upstream;dur=<ms>, app;dur=<ms>`, where `upstream` is the
// wall time it spent waiting on THIS service. That already separates "the ERP
// is slow" from "the hop is slow" as seen from the browser. What it cannot say
// is where inside this service the time went -- how much of that `upstream`
// figure was the handler's own work rather than network and function start.
// This adds `app;dur` measured HERE, so a slow screen can be attributed to a
// specific handler from a single request rather than from a log excavation.
//
// WHY IT DOES NOT REPLACE THE HANDLER'S EXPORT. Two CI guards in this repo
// read route files with a regex that requires `export async function GET`
// (scripts/check-route-error-handling.mjs and scripts/check-route-auth-guard.mjs).
// Rewriting the exports to `export const GET = withTiming(...)` would make the
// instrumented routes invisible to BOTH guards -- a real weakening of a
// guardrail, which AGENTS.md Rule 9 forbids. So the exported declaration stays
// exactly as it was and delegates to the original body:
//
//     export async function GET(...args: Parameters<typeof GET_impl>) {
//       return withRouteTiming("GET", () => GET_impl(...args))
//     }
//     async function GET_impl(request: NextRequest) { ...unchanged... }
//
// The guards still see the export, the try/catch and the requireAuth call in
// the same file; the timing is added around the body without touching a single
// line of it.

/**
 * Runs one route handler and stamps `Server-Timing: app;dur=<ms>` on whatever
 * it returns.
 *
 * `method` is accepted for the log line so a route with several handlers can
 * be told apart in the runtime logs; it is not part of the header, which
 * describes the response it rides on.
 *
 * A handler that throws is re-thrown untouched -- Next renders its own 500,
 * and swallowing it here to attach a header would turn a crash into a
 * malformed success.
 */
export async function withRouteTiming<T extends Response>(
  method: string,
  handler: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now()
  const res = await handler()
  const appMs = Date.now() - startedAt
  try {
    // Merge rather than overwrite: a handler that already set its own
    // Server-Timing entries (none do today, but a later one might) keeps them.
    const existing = res.headers.get("Server-Timing")
    res.headers.set("Server-Timing", existing ? `${existing}, app;dur=${appMs}` : `app;dur=${appMs}`)
  } catch {
    // A frozen Headers object is never worth failing a request that succeeded.
  }
  if (process.env.DEBUG_LATENCY === "1") {
    console.log(JSON.stringify({ t: "route", method, status: res.status, appMs }))
  }
  return res
}
