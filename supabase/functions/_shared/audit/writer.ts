// DPDP audit trail -- the one writer every Edge Function uses (owner spec 2026-10-06, items 1 and 9). PURE apart from the injected `rpc`.
//
// `rpc` is whatever calls a Postgres function by name (the Edge Functions pass their service-role client; tests pass a fake). A write NEVER throws into the caller:
// the audit trail must not take down the product it watches, so a failure comes back as { ok: false } and the caller counts it (the daily job reports the counters;
// database-side faults are in dpdp.audit_failure). Reading the SEAL KEY failing is the one thing that is not swallowed silently: it is returned as error "no_key"
// so a mis-set secret is loud in the logs rather than looking like a quiet outage.
import { type KeyRing } from "./seal.ts"
import { type AuditInput, buildContent } from "./event.ts"

export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>
export type AppendResult = { ok: true; id: string; seq: number; rowHash: string } | { ok: false; error: string }

export type Writer = {
  append(input: AuditInput, opts?: { aiCallId?: string | null; refHash?: string | null }): Promise<AppendResult>
  stats: { written: number; failed: number }
}

export function makeWriter(rpc: Rpc, ring: () => Promise<KeyRing>, now: () => number = Date.now): Writer {
  const stats = { written: 0, failed: 0 }
  return {
    stats,
    async append(input, opts = {}) {
      let built
      try {
        built = await buildContent(await ring(), input, now())
      } catch (e) {
        stats.failed++
        return { ok: false, error: e instanceof Error && /seal[_ ]key/i.test(e.message) ? "no_key" : "build_failed" }
      }
      try {
        const { data, error } = await rpc("dpdp_audit_append", { p_content: built.canonical, p_ai_call_id: opts.aiCallId ?? input.aiCallId ?? null, p_ref_hash: opts.refHash ?? input.refHash ?? null })
        if (error) { stats.failed++; return { ok: false, error: error.code ?? "db_error" } }
        const r = data as { id: string; seq: number; rowHash: string }
        stats.written++
        return { ok: true, id: r.id, seq: Number(r.seq), rowHash: r.rowHash }
      } catch {
        stats.failed++
        return { ok: false, error: "rpc_failed" }
      }
    },
  }
}

/** The caller's network facts from the request headers: the address Cloudflare / the gateway saw, never one the body claims. */
export function netFromHeaders(h: { get(n: string): string | null }): { ip: string | null; country: string | null; asn: string | null; userAgent: string | null } {
  const fwd = (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || null
  return {
    // The Pages proxy forwards the address it saw as x-dpdp-client-ip (WO-DPDP-013); a direct call has Cloudflare's own header or the first forwarded hop.
    ip: h.get("x-dpdp-client-ip") || h.get("cf-connecting-ip") || fwd || h.get("x-real-ip") || null,
    country: (h.get("x-dpdp-client-country") || h.get("cf-ipcountry") || "").slice(0, 2).toUpperCase() || null,
    asn: h.get("x-dpdp-client-asn") || null,
    userAgent: h.get("user-agent"),
  }
}
