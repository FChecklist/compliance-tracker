// Secret stripping for the PROJEXA client log (see src/lib/services/client-log-service.ts). Pure text/JSON functions, no database.
// Kept in its own file because it is regex-heavy and the nesting guard's source scanner (tenant-nesting-guard.test.ts) reads regex quotes as strings.

const SECRET_KEY = /(authorization|cookie|passw(or)?d|passwd|secret|token|api[-_]?key|apikey|private[-_]?key|access[-_]?key|credential|bearer)/i
export const REDACTED = "[redacted]"

/** Scrub secrets out of free text (messages, stacks, URLs, header dumps). */
export function scrubText(input: string): string {
  return input
    // whole header lines: "Authorization: Bearer abc", "Cookie: a=b; c=d"
    .replace(/\b(authorization|proxy-authorization|cookie|set-cookie)\b(["']?\s*[:=]\s*)[^\n\r]*/gi, `$1$2${REDACTED}`)
    // bare bearer / basic credentials
    .replace(/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${REDACTED}`)
    // key=value / "key": "value" / key:value for secret-looking keys (query strings, JSON dumps, form bodies)
    .replace(
      /\b([A-Za-z0-9_.-]*(?:passw(?:or)?d|passwd|secret|token|api[-_]?key|apikey|private[-_]?key|access[-_]?key|credential)[A-Za-z0-9_.-]*)(["']?\s*[:=]\s*["']?)[^\s"'&,;}\]]+/gi,
      `$1$2${REDACTED}`
    )
    // JWTs and this platform's key shapes wherever they appear
    .replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, REDACTED)
    .replace(/\b(vk|sk|pk|rk)_[A-Za-z0-9_-]{8,}/g, REDACTED)
}

/** Deep-scrub any JSON-like value: secret-named keys are blanked, every string is text-scrubbed. */
export function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return REDACTED
  if (typeof value === "string") return scrubText(value)
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => scrubValue(v, depth + 1))
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
      out[k] = SECRET_KEY.test(k) ? REDACTED : scrubValue(v, depth + 1)
    }
    return out
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value
  return undefined
}

