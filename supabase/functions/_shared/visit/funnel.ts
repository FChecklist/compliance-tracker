// Visitor-journey tracking -- the funnel arithmetic on the rows the database returns (dpdp.visit_funnel). PURE.
// The database decides which visitor reached which stage (from visit events, visit_link, organisation_created, the first-visit stamp and payment_confirmed); this file turns the
// per-source counts into the totals, the step-to-step and visit-to-stage conversion rates, and the "converted to sales, by source" table the owner reads.

export const STAGES = ["visits", "key_page", "cta", "signed_up", "org_created", "wizard_done", "paid"] as const
export type Stage = (typeof STAGES)[number]
export const STAGE_LABEL: Record<Stage, string> = {
  visits: "Visited", key_page: "Looked at a key page", cta: "Clicked a call to action", signed_up: "Signed up / signed in",
  org_created: "Created an organisation", wizard_done: "Finished the first-visit wizard", paid: "Paid",
}

export type FunnelRow = { source_kind: string; source_detail: string } & Record<Stage, number>
export type StageSummary = { stage: Stage; label: string; count: number; pctOfVisits: number; pctOfPrevious: number }
export type SourceConversion = { source: string; visits: number; signedUp: number; paid: number; visitToSignUp: number; visitToPaid: number }

/** a / b as a percentage with one decimal; 0 when b is 0 (an empty stage is 0%, never NaN). */
export function pct(a: number, b: number): number {
  return b > 0 ? Math.round((a / b) * 1000) / 10 : 0
}

const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0)

export function normaliseRows(rows: unknown): FunnelRow[] {
  if (!Array.isArray(rows)) return []
  return rows.map((r) => {
    const o = r as Record<string, unknown>
    return { source_kind: String(o.source_kind ?? "direct"), source_detail: String(o.source_detail ?? ""), visits: n(o.visits), key_page: n(o.key_page), cta: n(o.cta), signed_up: n(o.signed_up), org_created: n(o.org_created), wizard_done: n(o.wizard_done), paid: n(o.paid) }
  })
}

/** Totals over all sources, one entry per stage, with the share of all visits and of the previous stage. A later stage is never larger than the earlier one (the database counts "reached", which nests). */
export function summariseFunnel(rows: FunnelRow[]): StageSummary[] {
  const totals = STAGES.map((s) => rows.reduce((a, r) => a + n(r[s]), 0))
  return STAGES.map((stage, i) => ({ stage, label: STAGE_LABEL[stage], count: totals[i]!, pctOfVisits: pct(totals[i]!, totals[0]!), pctOfPrevious: i === 0 ? 100 : pct(totals[i]!, totals[i - 1]!) }))
}

/** Per source (kind + detail): visits, sign-ups, paid, and the two rates; most paid first, then most sign-ups, then most visits. */
export function conversionBySource(rows: FunnelRow[]): SourceConversion[] {
  const map = new Map<string, SourceConversion>()
  for (const r of rows) {
    const key = r.source_detail ? `${r.source_kind}: ${r.source_detail}` : r.source_kind
    const c = map.get(key) ?? { source: key, visits: 0, signedUp: 0, paid: 0, visitToSignUp: 0, visitToPaid: 0 }
    c.visits += n(r.visits); c.signedUp += n(r.signed_up); c.paid += n(r.paid)
    map.set(key, c)
  }
  return [...map.values()]
    .map((c) => ({ ...c, visitToSignUp: pct(c.signedUp, c.visits), visitToPaid: pct(c.paid, c.visits) }))
    .sort((a, b) => b.paid - a.paid || b.signedUp - a.signedUp || b.visits - a.visits || a.source.localeCompare(b.source))
}

type Rows = Array<Record<string, unknown>>
const arr = (v: unknown): Rows => (Array.isArray(v) ? (v as Rows) : [])
const cell = (v: unknown): string => String(v ?? "").replace(/\|/g, "/").replace(/\s+/g, " ")
const table = (head: string[], rows: unknown[][]): string => (rows.length ? `| ${head.join(" | ")} |\n|${head.map(() => "---").join("|")}|\n${rows.map((r) => `| ${r.map(cell).join(" | ")} |`).join("\n")}\n` : "_nothing yet_\n")

/** The owner's report as readable Markdown (the JSON stays the source of truth). */
export function reportToMarkdown(rep: Record<string, unknown>, funnelRows: FunnelRow[]): string {
  const t = (rep.totals ?? {}) as Record<string, unknown>
  const out: string[] = [`# Visitor journey -- last ${rep.days} days`, ""]
  out.push(`People (humans): ${t.human_visitors} visitors, ${t.human_sessions} visits, ${t.returning_visitors} came back. Crawlers: ${t.bot_sessions} visits (kept apart). Count-only (privacy signal on): ${rep.count_only_visits}.`, "")
  out.push("## Funnel", table(["Stage", "People", "% of visits", "% of previous step"], summariseFunnel(funnelRows).map((s) => [s.label, s.count, `${s.pctOfVisits}%`, `${s.pctOfPrevious}%`])))
  out.push("## Converted by source (first visit)", table(["Source", "Visits", "Signed up", "Paid", "Visit to sign-up", "Visit to paid"], conversionBySource(funnelRows).map((c) => [c.source, c.visits, c.signedUp, c.paid, `${c.visitToSignUp}%`, `${c.visitToPaid}%`])))
  out.push("## Sources", table(["Kind", "Detail", "Visits"], arr(rep.sources).map((r) => [r.kind, r.detail, r.sessions])))
  out.push("## Landing pages", table(["Page", "Visits"], arr(rep.landing_pages).map((r) => [r.path, r.sessions])))
  out.push("## Sections seen", table(["Page", "Section", "Views", "People", "Avg dwell (s)"], arr(rep.sections).map((r) => [r.path, r.section, r.views, r.sessions, Math.round(n(r.avg_dwell_ms) / 100) / 10])))
  out.push("## Where people left", table(["Page", "Section", "Visits", "Avg time (s)", "Avg scroll %"], arr(rep.exits).map((r) => [r.path, r.section, r.sessions, Math.round(n(r.avg_ms) / 100) / 10, r.avg_scroll])))
  out.push("## Calls to action", table(["Call to action", "Clicks", "People"], arr(rep.ctas).map((r) => [r.cta, r.clicks, r.sessions])))
  out.push("## Choices", table(["Choice", "Value", "Count"], arr(rep.choices).map((r) => [r.choice, r.value, r.count])))
  out.push("## Places and devices", table(["Country", "City", "Visits"], arr(rep.places).map((r) => [r.country, r.city, r.sessions])), table(["Device", "Visits"], arr(rep.devices).map((r) => [r.device, r.sessions])))
  out.push("## Coming back from the same address", table(["Address (hashed)", "Shortened", "Visits", "Visitor ids", "Country"], arr(rep.returning_ip_hashes).map((r) => [r.ip_hash, r.ip_short, r.sessions, r.visitors, r.country])))
  out.push("## Crawlers", table(["Crawler", "Visits"], arr(rep.bots).map((r) => [r.bot, r.sessions])))
  return out.join("\n")
}
