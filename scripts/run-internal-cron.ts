/// <reference types="bun-types" />
/**
 * scripts/run-internal-cron.ts -- PROJEXA-COST-001 (2026-09-22), PREPARE-ONLY.
 *
 * Invokes ONE of this repo's `/api/internal/<cron-path>/run` cron routes
 * in-process under Bun, WITHOUT starting a Next.js server. This is the
 * execution half of moving the seven TypeScript/LLM-stack crons (loops,
 * instruction-audit, dispatch-completion-monitor, capability-audit,
 * exchange-rate-refresh, l2-phrase-promotion, crm-lead-scoring) off Vercel
 * Cron and onto a scheduled GitHub Actions runner
 * (.github/workflows/cost001-cron-runner.yml, see ai-os/COST001_GHA_RUNNER_NOTES.md).
 *
 *   bun scripts/run-internal-cron.ts <cron-path>
 *     e.g.  bun scripts/run-internal-cron.ts loops
 *           bun scripts/run-internal-cron.ts the-firm/recur-engagements
 *
 * WHAT IT DOES. Dynamically imports
 * `../src/app/api/internal/<cron-path>/run/route.ts`, builds the exact
 * NextRequest Vercel Cron would have sent (GET http://localhost/api/internal/
 * <cron-path>/run with `authorization: Bearer $CRON_SECRET`), awaits the
 * module's exported `GET`, and prints the status, elapsed ms and the body
 * (truncated to BODY_PRINT_LIMIT characters). Every one of these routes
 * already fails closed when CRON_SECRET is unset or wrong (401), so this
 * script never bypasses that check -- it goes through it, exactly like the
 * real cron invocation does.
 *
 * EXIT CODES.
 *   0  the route answered 2xx
 *   1  the route answered non-2xx, or the handler threw
 *   2  usage / path / import error -- nothing was invoked
 *
 * PATH GUARD. <cron-path> must match CRON_PATH_PATTERN (lowercase letters,
 * digits, hyphens; slash-separated segments). That rules out `..`, spaces,
 * backslashes, leading/trailing/double slashes and anything else that could
 * escape src/app/api/internal/ -- the import specifier is built only from a
 * value that has already passed this check.
 *
 * TESTABILITY. Everything except the actual dynamic import lives in exported
 * pure-ish functions (path validation, request/header building, handler
 * invocation, result shaping, exit-code mapping) so run-internal-cron.test.ts
 * can exercise them against a stubbed route module without importing a real
 * route (real routes pull in the DB client). `main()` is the only place a real
 * route module is imported, and it only runs under `import.meta.main`.
 *
 * SECRETS. The CRON_SECRET value is never printed -- only whether it was set.
 */
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { NextRequest } from "next/server"

export const CRON_PATH_PATTERN = /^[a-z0-9-]+(\/[a-z0-9-]+)*$/
export const BODY_PRINT_LIMIT = 4096 // characters (~4 KB for the ASCII/JSON bodies these routes return)

export const EXIT_OK = 0
export const EXIT_ROUTE_FAILED = 1
export const EXIT_USAGE = 2

export type CronRouteHandler = (request: NextRequest) => Response | Promise<Response>
export type CronRouteModule = { GET?: unknown; POST?: unknown }

export type PathValidation = { ok: true; path: string } | { ok: false; reason: string }

export function validateCronPath(raw: unknown): PathValidation {
  if (typeof raw !== "string" || raw.length === 0) {
    return { ok: false, reason: "missing <cron-path> argument (e.g. `loops` or `the-firm/recur-engagements`)" }
  }
  if (!CRON_PATH_PATTERN.test(raw)) {
    return {
      ok: false,
      reason:
        `invalid cron path ${JSON.stringify(raw)} -- must match ${CRON_PATH_PATTERN} ` +
        `(lowercase letters, digits and hyphens in slash-separated segments; no "..", spaces, ` +
        `backslashes, or leading/trailing/double slashes)`,
    }
  }
  return { ok: true, path: raw }
}

/** Relative (to this script) module path of the route for a validated cron path. */
export function routeModuleRelativePath(cronPath: string): string {
  return `../src/app/api/internal/${cronPath}/run/route.ts`
}

/** Absolute file URL of the route module -- what `import()` is actually handed. */
export function resolveRouteModuleUrl(cronPath: string): URL {
  return new URL(routeModuleRelativePath(cronPath), import.meta.url)
}

export function buildRequestUrl(cronPath: string): string {
  return `http://localhost/api/internal/${cronPath}/run`
}

/**
 * The header Vercel Cron sends when CRON_SECRET is configured. With no
 * secret we send NO header rather than `Bearer undefined` -- the route
 * answers 401 either way (every internal cron route's isAuthorized()
 * returns false on an unset secret), but "absent" is the honest shape.
 */
export function buildAuthHeaders(secret: string | undefined): Record<string, string> {
  if (!secret) return {}
  return { authorization: `Bearer ${secret}` }
}

export function buildCronRequest(cronPath: string, secret: string | undefined): NextRequest {
  return new NextRequest(buildRequestUrl(cronPath), { method: "GET", headers: buildAuthHeaders(secret) })
}

export function exitCodeForStatus(status: number): number {
  return status >= 200 && status < 300 ? EXIT_OK : EXIT_ROUTE_FAILED
}

export function truncateBody(text: string, limit = BODY_PRINT_LIMIT): string {
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}\n... [truncated: ${text.length - limit} more characters, ${text.length} total]`
}

/** Pretty-prints JSON bodies (these routes all answer NextResponse.json); passes anything else through. */
export function formatBody(raw: string, contentType: string | null): string {
  if (contentType && contentType.toLowerCase().includes("json")) {
    try {
      return JSON.stringify(JSON.parse(raw), null, 2)
    } catch {
      // not actually JSON -- fall through and print it raw
    }
  }
  return raw
}

export function getHandler(mod: CronRouteModule): CronRouteHandler | null {
  return typeof mod.GET === "function" ? (mod.GET as CronRouteHandler) : null
}

export type CronRunResult =
  | { kind: "response"; status: number; elapsedMs: number; contentType: string | null; body: string; exitCode: number }
  | { kind: "threw"; elapsedMs: number; error: string; exitCode: number }

/**
 * Runs one handler against one request and shapes the outcome. Never
 * throws: a handler that throws (none of the seven target routes should --
 * each wraps its work in try/catch and answers 500 -- but the runner must
 * not depend on that) is reported as `kind: "threw"` with exit code 1.
 */
export async function runCronHandler(handler: CronRouteHandler, request: NextRequest): Promise<CronRunResult> {
  const started = performance.now()
  try {
    const response = await handler(request)
    const elapsedMs = Math.round(performance.now() - started)
    const contentType = response.headers.get("content-type")
    const raw = await response.text()
    return {
      kind: "response",
      status: response.status,
      elapsedMs,
      contentType,
      body: formatBody(raw, contentType),
      exitCode: exitCodeForStatus(response.status),
    }
  } catch (err) {
    const elapsedMs = Math.round(performance.now() - started)
    const error = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    return { kind: "threw", elapsedMs, error, exitCode: EXIT_ROUTE_FAILED }
  }
}

export function renderResult(cronPath: string, secretPresent: boolean, result: CronRunResult): string {
  const lines = [
    `cron         : ${cronPath}`,
    `url          : ${buildRequestUrl(cronPath)}`,
    `auth header  : ${secretPresent ? "present (CRON_SECRET set; value not printed)" : "ABSENT (CRON_SECRET not set -- route fails closed with 401)"}`,
  ]
  if (result.kind === "response") {
    lines.push(
      `status       : ${result.status}`,
      `elapsed_ms   : ${result.elapsedMs}`,
      `content-type : ${result.contentType ?? "(none)"}`,
      `body (${result.body.length} chars, printed up to ${BODY_PRINT_LIMIT}):`,
      truncateBody(result.body),
    )
  } else {
    lines.push(`status       : (handler threw)`, `elapsed_ms   : ${result.elapsedMs}`, `error        : ${result.error}`)
  }
  lines.push(`exit code    : ${result.exitCode}`)
  return lines.join("\n")
}

/**
 * CLI entry. `env` and `log` are injectable so the usage-error paths can be
 * unit-tested; the happy path imports a real route module and is exercised
 * only by hand (see ai-os/COST001_GHA_RUNNER_NOTES.md, "local mechanics check").
 */
export async function main(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
  log: (line: string) => void = console.log,
): Promise<number> {
  const validation = validateCronPath(argv[0])
  if (!validation.ok) {
    log(`usage: bun scripts/run-internal-cron.ts <cron-path>\n${validation.reason}`)
    return EXIT_USAGE
  }
  const cronPath = validation.path

  const moduleUrl = resolveRouteModuleUrl(cronPath)
  if (!existsSync(fileURLToPath(moduleUrl))) {
    log(`no such cron route: ${routeModuleRelativePath(cronPath)} (nothing invoked)`)
    return EXIT_USAGE
  }

  let mod: CronRouteModule
  try {
    mod = (await import(moduleUrl.href)) as CronRouteModule
  } catch (err) {
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    log(`failed to import ${routeModuleRelativePath(cronPath)} (nothing invoked): ${message}`)
    return EXIT_USAGE
  }

  const handler = getHandler(mod)
  if (!handler) {
    log(`${routeModuleRelativePath(cronPath)} exports no GET handler (nothing invoked)`)
    return EXIT_USAGE
  }

  const secret = env.CRON_SECRET
  if (!secret) {
    log("warning: CRON_SECRET is not set -- no authorization header will be sent; every internal cron route fails closed with 401 in that case")
  }

  const result = await runCronHandler(handler, buildCronRequest(cronPath, secret))
  log(renderResult(cronPath, Boolean(secret), result))
  return result.exitCode
}

// import.meta.main (Bun's entrypoint check, same convention as
// scripts/audit-asset-registry.ts and friends) so importing this module from
// a test never runs the CLI. process.exit is deliberate: a route that opened
// a postgres.js pool may otherwise keep the event loop alive after we are done.
if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err)
      process.exit(EXIT_USAGE)
    },
  )
}
