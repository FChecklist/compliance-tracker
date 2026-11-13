// The weekly ICP block of the Monday e-mail (drizzle/0763 public.dpdp_timer_icp_weekly): this week's Identify / Classify / Prove checklist, the weekly
// score, what is still open from last week, and, for a Professional (firm) organisation, a per-client roll-up. Pure functions: no I/O, no clock.
//
// WORDING RULES (the owner's, kept in the tests): the score is "N of M steps of this week's routine" -- never a rating, never "compliant", "certified" or
// "guaranteed". A client's line is counts only. Nothing in the block is a person's name, e-mail address or phone number: the database never puts one there.
// The links open the signed-in page where the step is done (one tap away); they carry no credential of their own.

export type IcpStep = { key: string; label: string; done: boolean; count: number | null; action?: string | null }
export type IcpStage = { stage: "identify" | "classify" | "prove"; title: string; done: number; total: number; steps: IcpStep[] }
export type IcpClient = {
  orgId: string; name: string; started: boolean; percent: number; done: number; total: number
  identify: { done: number; total: number }; classify: { done: number; total: number }; prove: { done: number; total: number }
}
export type IcpBlock = {
  orgId: string
  orgName: string
  product: string
  weekStart: string // YYYY-MM-DD, the Monday
  percent: number
  done: number
  total: number
  status: "not_started" | "in_progress" | "complete" | string
  stages: IcpStage[]
  carriedOver: Array<{ stage: string; key: string; label: string; count: number | null }>
  viewerMembershipIds: string[]
  snapshotsAdded?: number
  clients: IcpClient[]
  clientTotal: number
  notALegalRating: boolean
  note: string
  /** Set by the sender: true only on a real send (a dry run records nothing, so it must not say it did). */
  recorded?: boolean
}

const MAX_CLIENT_LINES = 20

const e = (s: unknown): string => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`

export function icpLongDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return ymd
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
  return `${Number(m[3])} ${months[Number(m[2]) - 1] ?? m[2]} ${m[1]}`
}

/** True when this block is worth putting in an e-mail at all: it has stages. (A malformed block from the database is dropped, never half-rendered.) */
export function icpBlockUsable(b: IcpBlock | null | undefined): b is IcpBlock {
  return !!b && Array.isArray(b.stages) && b.stages.length === 3 && b.stages.every((s) => Array.isArray(s.steps)) && typeof b.percent === "number" && typeof b.total === "number" && b.total > 0
}

/** The headline sentence: a count of this week's steps, in plain words. */
export function icpHeadline(b: IcpBlock): string {
  if (b.done === 0) return `Nothing from this week's routine is done yet: ${b.total} steps to go.`
  if (b.done >= b.total) return `All ${b.total} steps of this week's routine are done.`
  return `${b.done} of ${b.total} steps of this week's routine are done (${b.percent}%).`
}

const STAGE_HASH: Record<string, string> = { identify: "icp-stage-identify", classify: "icp-stage-classify", prove: "icp-stage-prove" }
export function icpStageLink(appHome: string, stage: string): string {
  return `${appHome.replace(/#.*$/, "")}#${STAGE_HASH[stage] ?? "icp-h"}`
}

function clientLine(c: IcpClient): string {
  if (!c.started) return `${c.name}: the routine has not been started (${c.done} of ${c.total} steps)`
  return `${c.name}: ${c.done} of ${c.total} steps (${c.percent}%). Identify ${c.identify.done}/${c.identify.total}, Classify ${c.classify.done}/${c.classify.total}, Prove ${c.prove.done}/${c.prove.total}`
}

export function renderIcpBlock(b: IcpBlock, appHome: string): { html: string; text: string[] } {
  const html: string[] = []
  const text: string[] = []
  const head = `This week's routine: Identify, Classify, Prove`
  html.push(`<h2 style="color:#1C2B3A;font-size:15px;margin:20px 0 4px;">${e(head)}</h2>`)
  text.push(head.toUpperCase())
  html.push(`<p style="color:#1C2B3A;font-size:14px;line-height:1.6;margin:0 0 4px;font-weight:700;">${e(icpHeadline(b))}</p>`)
  text.push(icpHeadline(b))
  const sub = `Week of ${icpLongDate(b.weekStart)}. This counts the steps of the routine; it is not a rating of ${b.orgName}'s legal position.`
  html.push(`<p style="color:#64748B;font-size:12.5px;line-height:1.5;margin:0 0 10px;">${e(sub)}</p>`)
  text.push(sub, "")

  for (const s of b.stages) {
    const link = icpStageLink(appHome, s.stage)
    html.push(`<p style="margin:10px 0 2px;font-size:14px;color:#1C2B3A;"><b>${e(s.title)}</b> <span style="color:#64748B;">(${s.done} of ${s.total})</span></p>`)
    text.push(`${s.title} (${s.done} of ${s.total})`)
    html.push(`<ul style="margin:0 0 4px;padding:0 0 0 18px;font-size:13.5px;line-height:1.55;color:#334155;">${s.steps.map((st) => `<li>${st.done ? "Done" : "To do"}: ${e(st.label)}${st.count !== null && st.count !== undefined && !st.done ? ` <span style="color:#64748B;">(${st.count})</span>` : ""}</li>`).join("")}</ul>`)
    for (const st of s.steps) text.push(`  ${st.done ? "[done]" : "[to do]"} ${st.label}${st.count !== null && st.count !== undefined && !st.done ? ` (${st.count})` : ""}`)
    const open = s.steps.filter((x) => !x.done).length
    const label = open === 0 ? `Open ${s.stage}` : `Do the ${plural(open, "step")} left in ${s.stage}`
    html.push(`<p style="margin:2px 0 8px;"><a href="${e(link)}" style="display:inline-block;padding:7px 12px;border-radius:8px;text-decoration:none;font-weight:600;font-size:13px;background:#1C2B3A;color:#fff;">${e(label)}</a></p>`)
    text.push(`  ${label}: ${link}`, "")
  }

  if (b.carriedOver.length) {
    html.push(`<h3 style="color:#B45309;font-size:14px;margin:12px 0 4px;">Still open from last week (${b.carriedOver.length})</h3>`)
    text.push(`STILL OPEN FROM LAST WEEK (${b.carriedOver.length})`)
    html.push(`<ul style="margin:0 0 6px;padding:0 0 0 18px;font-size:13.5px;line-height:1.55;color:#92400E;">${b.carriedOver.map((c) => `<li>${e(c.label)} <span style="color:#64748B;">(${e(c.stage)})</span></li>`).join("")}</ul>`)
    for (const c of b.carriedOver) text.push(`  - ${c.label} (${c.stage})`)
    text.push("")
  }

  if (b.recorded) {
    const kept = "A snapshot of this list has been added to your weekly record, so there is a dated line for this week even if nobody opens the page."
    html.push(`<p style="color:#64748B;font-size:12.5px;line-height:1.5;margin:6px 0 0;">${e(kept)}</p>`)
    text.push(kept, "")
  }

  if (b.product === "firm" && b.clientTotal > 0) {
    const shown = b.clients.slice(0, MAX_CLIENT_LINES)
    html.push(`<h3 style="color:#1C2B3A;font-size:14px;margin:16px 0 4px;">Your clients this week (${b.clientTotal})</h3>`)
    text.push(`YOUR CLIENTS THIS WEEK (${b.clientTotal})`)
    html.push(`<ul style="margin:0 0 6px;padding:0 0 0 18px;font-size:13.5px;line-height:1.55;color:#334155;">${shown.map((c) => `<li>${e(clientLine(c))}</li>`).join("")}</ul>`)
    for (const c of shown) text.push(`  - ${clientLine(c)}`)
    if (b.clientTotal > shown.length) {
      const more = `And ${b.clientTotal - shown.length} more: open the page for the full list.`
      html.push(`<p style="color:#64748B;font-size:12.5px;margin:0 0 6px;">${e(more)}</p>`)
      text.push(`  ${more}`)
    }
    const hint = "Worst first. These are counts of each client's own routine steps, not a rating of any client."
    html.push(`<p style="color:#64748B;font-size:12.5px;margin:0 0 6px;">${e(hint)}</p>`)
    text.push(hint, "")
  }
  return { html: html.join("\n"), text }
}
