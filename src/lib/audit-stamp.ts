// AUDIT TRAIL slice 1 (ai-os/audit37/AUDIT_TRAIL_DESIGN_2026-10-06.md, owner decisions in section 10).
// Pure helper, no database, no network: builds the "stamp" that logActivity() stores in the internal-only columns added by
// drizzle/0730_audit_trail_stamp_columns.sql.
//
// Principle (design 2.2): the SERVER sets everything it can observe (server time, full IP, user agent, channel, source). The client may only
// claim three things: device id (header x-px-device), its own clock (header x-px-client-time) and a correlation id. Those are stored as claimed
// evidence, never used to order or decide anything. Owner decision 10.1: the FULL ip address and full user agent are kept (no truncation);
// ip_prefix and ua_family are grouping helpers only.
import { isIP } from "node:net"

export const AUDIT_PRODUCTS = ["projexa", "veridian_dpdp", "tambola"] as const
export const AUDIT_CHANNELS = ["web", "ai", "offline", "online", "sync"] as const
export const AUDIT_SOURCES = ["ui", "ai_link", "outbox_replay", "peer_sync", "server_job", "import"] as const
export const AUDIT_ACTION_CLASSES = ["create", "edit", "delete", "restore", "import", "other"] as const

export type AuditProduct = (typeof AUDIT_PRODUCTS)[number]
export type AuditChannel = (typeof AUDIT_CHANNELS)[number]
export type AuditSource = (typeof AUDIT_SOURCES)[number]
export type AuditActionClass = (typeof AUDIT_ACTION_CLASSES)[number]

export const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/
// A client clock further than this from the server clock is treated as garbage and dropped (not stored, no skew).
export const MAX_CLIENT_CLOCK_DISTANCE_MS = 366 * 24 * 60 * 60 * 1000

export type AuditStamp = {
  product: AuditProduct | null
  channel: AuditChannel | null
  source: AuditSource | null
  actionClass: AuditActionClass | null
  deviceId: string | null
  aiName: string | null
  aiLinkId: string | null
  aiCallId: string | null
  clientAt: Date | null
  serverAt: Date
  clockSkewMs: number | null
  /** FULL address as observed (owner decision 10.1). null when absent or malformed. */
  ipAddress: string | null
  ipPrefix: string | null
  /** Full user-agent string. */
  userAgent: string | null
  uaFamily: string | null
  internetId: string | null
  correlationId: string | null
  relayDeviceId: string | null
  diff: Record<string, [unknown, unknown]> | null
}

export type BuildStampOptions = {
  channel?: AuditChannel
  source?: AuditSource
  product?: AuditProduct
  actionClass?: AuditActionClass
  /** SERVER-DERIVED AI fields: only a trusted server path (the AI-link execution function) may pass these, never a request body. */
  ai?: { name?: string; linkId?: string; callId?: string }
  correlationId?: string
  relayDeviceId?: string
  diff?: Record<string, [unknown, unknown]>
  /** For tests. */
  now?: Date
}

function oneOf<T extends string>(list: readonly T[], v: unknown): T | null {
  return typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : null
}

function clean(v: string | null | undefined, max: number): string | null {
  if (typeof v !== "string") return null
  const t = v.trim()
  return t.length === 0 ? null : t.slice(0, max)
}

/** First address of x-forwarded-for, else x-real-ip. Full address kept; anything that is not a valid IPv4/IPv6 literal becomes null. */
export function observedIp(request?: Request): string | null {
  if (!request) return null
  const fwd = request.headers.get("x-forwarded-for")
  const raw = fwd ? fwd.split(",")[0]!.trim() : (request.headers.get("x-real-ip") ?? "").trim()
  return isIP(raw) ? raw : null
}

/** Grouping helper: /24 for IPv4, /48 for IPv6. Not a privacy control (the full address is stored too). */
export function ipPrefixOf(ip: string | null): string | null {
  if (!ip) return null
  const v = isIP(ip)
  if (v === 4) return ip.split(".").slice(0, 3).join(".") + ".0/24"
  if (v === 6) {
    const [left, right = ""] = ip.toLowerCase().split("::")
    const l = left ? left.split(":") : []
    const r = right ? right.split(":") : []
    const missing = ip.includes("::") ? 8 - l.length - r.length : 0
    const groups = [...l, ...Array(Math.max(missing, 0)).fill("0"), ...r]
    if (groups.length !== 8) return null
    return groups.slice(0, 3).map((g) => g.replace(/^0+(?=.)/, "")).join(":") + "::/48"
  }
  return null
}

export function uaFamilyOf(ua: string | null): string | null {
  if (!ua) return null
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome"
    : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : /^node|undici|curl|python|axios|okhttp/i.test(ua) ? "Script" : "Other"
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad|iOS/.test(ua) ? "iOS"
    : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : null
  return os ? `${browser} on ${os}` : browser
}

export function buildStamp(request: Request | undefined, opts: BuildStampOptions = {}): AuditStamp {
  const serverAt = opts.now ?? new Date()
  const h = request?.headers

  const rawDevice = h?.get("x-px-device")?.trim() ?? ""
  const deviceId = DEVICE_ID_PATTERN.test(rawDevice) ? rawDevice : null

  let clientAt: Date | null = null
  const rawClient = h?.get("x-px-client-time")?.trim()
  if (rawClient) {
    const t = /^\d{10,13}$/.test(rawClient) ? (rawClient.length <= 10 ? Number(rawClient) * 1000 : Number(rawClient)) : Date.parse(rawClient)
    if (Number.isFinite(t) && Math.abs(t - serverAt.getTime()) <= MAX_CLIENT_CLOCK_DISTANCE_MS) clientAt = new Date(t)
  }

  const ip = observedIp(request)
  const userAgent = clean(h?.get("user-agent"), 1024)
  const relay = clean(opts.relayDeviceId, 64)

  return {
    product: oneOf(AUDIT_PRODUCTS, opts.product),
    channel: oneOf(AUDIT_CHANNELS, opts.channel),
    source: oneOf(AUDIT_SOURCES, opts.source),
    actionClass: oneOf(AUDIT_ACTION_CLASSES, opts.actionClass),
    deviceId,
    aiName: clean(opts.ai?.name, 200),
    aiLinkId: clean(opts.ai?.linkId, 100),
    aiCallId: clean(opts.ai?.callId, 100),
    clientAt,
    serverAt,
    clockSkewMs: clientAt ? serverAt.getTime() - clientAt.getTime() : null,
    ipAddress: ip,
    ipPrefix: ipPrefixOf(ip),
    userAgent,
    uaFamily: uaFamilyOf(userAgent),
    internetId: clean(h?.get("x-px-internet-id"), 100),
    correlationId: clean(opts.correlationId ?? h?.get("x-request-id") ?? undefined, 100),
    relayDeviceId: relay && DEVICE_ID_PATTERN.test(relay) ? relay : null,
    diff: opts.diff ?? null,
  }
}

const FORGEABLE = /^(channel|source|product|actionclass|serverat|clientat|clockskewms|relaydeviceid|ai.*)$/

/**
 * Removes every key an AI (or any untrusted caller) could use to forge the stamp from its own input, at any depth:
 * channel, source, product, action_class, server_at, client_at, clock_skew_ms, relay_device_id and anything starting with ai (ai_name, aiLinkId...).
 * Returns a new value; the input is not modified.
 */
export function stripForgedStamp<T>(params: T): T {
  if (Array.isArray(params)) return params.map((v) => stripForgedStamp(v)) as unknown as T
  if (params && typeof params === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
      if (FORGEABLE.test(k.replace(/[_-]/g, "").toLowerCase())) continue
      out[k] = stripForgedStamp(v)
    }
    return out as T
  }
  return params
}
