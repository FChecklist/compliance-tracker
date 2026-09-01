// VERIDIAN Review Framework gap-closure (task-20260718-065003-ai-engineering-
// quality--error-handling), [Medium] Logging Quality: "No confirmed
// centralized structured logging utility." This is that utility -- a
// lightweight, correlation-ID-aware, structured *operational* logger.
//
// Deliberately NOT the same thing as `src/lib/audit.ts` (`auditLogs`
// table) or `src/lib/orchestra-execution-logger.ts` (`orchestraExecutions`
// table, AI-call cost/token observability). Those are compliance/business
// records -- durable, queryable, org-scoped, part of the product. This is
// operational/debugging logging: request-scoped, correlation-ID-tagged,
// emitted as JSON lines to stdout/stderr (the standard pattern for a
// serverless/edge runtime -- Vercel and any other log collector ingest
// stdout directly, no separate transport needed). It has no DB dependency
// on purpose, so it's safe to call from `edge` runtime routes and from
// code paths that must not risk a logging failure blocking the request
// they're trying to describe.
//
// Usage in a route.ts, alongside the established try/catch + ServiceError
// pattern (see any of the ~90% of routes that already do this, e.g.
// src/app/api/access-review/cycles/[id]/certifications/[certId]/route.ts):
//
//   import { logger, getCorrelationId } from "@/lib/logger"
//
//   export async function POST(request: Request) {
//     const correlationId = getCorrelationId(request)
//     try {
//       ...
//     } catch (error) {
//       if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
//       logger.error("Failed to create widget", error, { correlationId, route: "/api/widgets" })
//       return NextResponse.json({ error: "Failed to create widget" }, { status: 500 })
//     }
//   }

export type LogLevel = "debug" | "info" | "warn" | "error"

export type LogContext = {
  correlationId?: string
  orgId?: string
  userId?: string
  route?: string
  [key: string]: unknown
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

function resolveMinLevel(): LogLevel {
  const raw = (typeof process !== "undefined" ? process.env?.LOG_LEVEL : undefined)?.toLowerCase()
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") return raw
  return "info"
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[resolveMinLevel()]
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { errorName: error.name, errorMessage: error.message, errorStack: error.stack }
  }
  if (error === undefined) return {}
  return { errorDetail: typeof error === "string" ? error : JSON.stringify(error) }
}

function emit(level: LogLevel, message: string, context: LogContext = {}): void {
  if (!shouldLog(level)) return
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context,
  }
  const line = JSON.stringify(entry)
  if (level === "error") console.error(line)
  else if (level === "warn") console.warn(line)
  else console.log(line)
}

export const logger = {
  debug(message: string, context?: LogContext): void {
    emit("debug", message, context)
  },
  info(message: string, context?: LogContext): void {
    emit("info", message, context)
  },
  warn(message: string, context?: LogContext): void {
    emit("warn", message, context)
  },
  // `error` is second (not folded into `context`) so a caught `unknown`
  // from a catch block can be passed straight through without the caller
  // having to shape it first -- matches the existing `console.error(msg,
  // error)` call shape already used across route.ts catch blocks, just
  // structured instead of free text.
  error(message: string, error?: unknown, context?: LogContext): void {
    emit("error", message, { ...context, ...serializeError(error) })
  },
}

const CORRELATION_HEADER_CANDIDATES = ["x-correlation-id", "x-request-id"] as const

// Reads an inbound correlation ID (from a proxy, an upstream caller, or a
// prior hop) off the request, or mints a fresh one. Callers should thread
// the returned ID through to every `logger.*` call for that request (and,
// where reasonable, back out on the response via the same header) so a
// single request's log lines can be grepped/joined by one ID end to end.
export function getCorrelationId(request: Request): string {
  for (const header of CORRELATION_HEADER_CANDIDATES) {
    const value = request.headers.get(header)
    if (value) return value
  }
  return crypto.randomUUID()
}
