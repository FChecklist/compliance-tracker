// The outbox flush, with its collaborators passed in so bun tests run it without Deno or a network.
import { buildOutbound, type OutboundEnvelope } from "../_shared/mail-outbound.ts"
import { type Notice, type Rendered, isDeliverableAddress, renderNotice } from "./render.ts"

export type FlushDeps = {
  /** public.dpdp_partner_notices_pending */
  pending: (limit: number) => Promise<Notice[]>
  /** public.dpdp_partner_notice_mark */
  mark: (id: string, status: "sent" | "failed" | "skipped", error?: string) => Promise<void>
  /** Resend. Returns the provider id. */
  send: (to: string, rendered: Rendered, out: OutboundEnvelope) => Promise<string>
  /** Best-effort outbound log; must never throw. */
  log: (entry: { ref: string; to: string; subject: string; providerMessageId: string | null }) => Promise<void>
  from: string
  dryRun: boolean
}

export type FlushSummary = { found: number; sent: number; skipped: number; failed: number; dryRun: boolean }

/** One partner email at a time; one failure never stops the rest. A dry run marks nothing. */
export async function flushNotices(deps: FlushDeps, limit = 50): Promise<FlushSummary> {
  const summary: FlushSummary = { found: 0, sent: 0, skipped: 0, failed: 0, dryRun: deps.dryRun }
  const notices = await deps.pending(limit)
  summary.found = notices.length
  for (const n of notices) {
    if (!isDeliverableAddress(n.to)) {
      summary.skipped++
      if (!deps.dryRun) await deps.mark(n.id, "skipped")
      continue
    }
    if (deps.dryRun) continue
    try {
      const rendered = renderNotice(n)
      const out = buildOutbound("partner", rendered.subject, { from: deps.from })
      const providerId = await deps.send(n.to, rendered, out)
      await deps.log({ ref: out.ref, to: n.to, subject: out.subject, providerMessageId: providerId || null })
      await deps.mark(n.id, "sent")
      summary.sent++
    } catch (e) {
      summary.failed++
      await deps.mark(n.id, "failed", e instanceof Error ? e.message : String(e))
    }
  }
  return summary
}
