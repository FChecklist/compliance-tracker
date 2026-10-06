// DPDP audit trail -- one audit row for every AI work-link call (owner spec 2026-10-06, item 9). PURE apart from the injected writer / rpc.
//
// EXTENDS the existing call log (dpdp.ai_link_call, drizzle/0610): that log stays the rate-limit source and the per-call status/bytes; this adds the audit row, joined
// to it by `ai_call_id` (and used as the request id), carrying what an auditor asks that the call log never held: which fetcher and vendor the SERVER observed,
// what the caller DECLARED about itself (model, version, session, machine -- optional headers X-AI-Model / X-AI-Version / X-AI-Session / X-AI-Machine or the query
// parameters ai_model / ai_version / ai_session / ai_machine), whether claim and observation disagree, the link id and token fingerprint (the hash prefix, never the
// token), the person the link acts for, and the hash of the guide text that was handed over.
//
// A call whose token matches NO link is not written here: it has no organisation to chain under, and writing guessed-token noise into a customer's chain would let any
// scanner grow it. Those calls stay in dpdp.ai_link_call (link_id null), exactly as before.
import { type EventType } from "./event.ts"
import { type VendorRanges, readDeclaration } from "./provenance.ts"
import { type Rpc, type Writer, netFromHeaders } from "./writer.ts"

export type AiCallClass = { eventType: EventType; outcome: "ok" | "denied" | "failed" }

/** Reads are ai_read; every POST is the AI preparing something (ai_prepare); a refusal (401, 403, 410, 429) is `denied`; a server fault keeps its type with outcome failed. */
export function classifyAiCall(method: string, status: number): AiCallClass {
  if (status === 401 || status === 403 || status === 410 || status === 429) return { eventType: "denied", outcome: "denied" }
  const base: EventType = method.toUpperCase() === "GET" || method.toUpperCase() === "HEAD" ? "ai_read" : "ai_prepare"
  return { eventType: base, outcome: status >= 500 ? "failed" : "ok" }
}

export async function sha256HexOfBytes(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as ArrayBuffer))
  let s = ""
  for (const b of d) s += b.toString(16).padStart(2, "0")
  return s
}

/** Routes whose answer is a guide / prompt the AI will follow: the audit row records the hash of exactly what was given. */
export const GUIDE_ROUTES: ReadonlyArray<string> = ["manual", "prompt", "snapshot", "playbook"]

export type AiCallAuditInput = {
  rpc: Rpc
  writer: Writer
  headers: { get(n: string): string | null }
  url: URL
  method: string
  relativePath: string
  routeKind: string
  status: number
  callId: string | null
  linkId: string | null
  guideHash?: string | null
  vendorRanges: VendorRanges
}

export async function auditAiLinkCall(d: AiCallAuditInput): Promise<{ written: boolean; reason?: string }> {
  if (!d.linkId) return { written: false, reason: "unknown_link" }
  type LinkCtx = { found?: boolean; orgId?: string; identityId?: string; role?: string; tokenFp?: string; level?: number }
  let ctx = null as LinkCtx | null
  try {
    const r = await d.rpc("dpdp_audit_link_context", { p_link_id: d.linkId })
    ctx = r.error ? null : (r.data as LinkCtx)
  } catch {
    ctx = null
  }
  if (!ctx || !ctx.found || !ctx.orgId) return { written: false, reason: "link_not_found" }
  const c = classifyAiCall(d.method, d.status)
  const res = await d.writer.append({
    orgId: ctx.orgId,
    eventType: c.eventType,
    outcome: c.outcome,
    actorType: "ai_link",
    actorUserId: ctx.identityId ?? null,
    actorRole: ctx.role ?? null,
    target: d.callId ? { table: "dpdp.ai_link_call", id: d.callId } : null,
    details: { method: d.method, path: d.relativePath, status: d.status, route: d.routeKind, link_level: ctx.level ?? null },
    requestId: d.callId,
    aiCallId: d.callId,
    net: netFromHeaders(d.headers),
    ai: { declared: readDeclaration(d.headers, d.url.searchParams), vendorRanges: d.vendorRanges },
    link: { id: d.linkId, tokenFp: ctx.tokenFp ?? null },
    guideHash: GUIDE_ROUTES.includes(d.routeKind) && d.status < 300 ? d.guideHash ?? null : null,
  })
  return res.ok ? { written: true } : { written: false, reason: res.error }
}
