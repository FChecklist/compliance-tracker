// WO-DPDP-012 §7: the clean-HTML + Markdown renderer for the AI link page
// served by ../dpdp-ai-link/index.ts. PURE -- no Deno globals, no fetch, no
// Date.now() (the caller passes `now`) -- so bun can unit-test it from the
// repo root (src/lib/services/dpdp-ai-link-render.test.ts) without a Deno
// toolchain. The page is PRIVATE (WO-012 §2/§0): no <script> at all, inline
// CSS only, no external resource of any kind, `noindex` meta; the response
// headers that pair with it (X-Robots-Tag, Referrer-Policy, Cache-Control,
// CSP) live in index.ts.
//
// Everything the AI needs to act is on the page itself: the five verbs and
// their payload shapes, the draft endpoint, and each job's id. Everything
// the AI must understand about authority is stated plainly at the top --
// read-only, a draft changes nothing, the person confirms in their own
// browser -- in the same words for both formats.

export const VERBS = ["ASSIGN", "SET_DUE", "NOTE", "MARK_NA", "DRAFT"] as const
export type Verb = (typeof VERBS)[number]

export const REFUSED_ACTIONS = "close, delete, adding or removing people, changing who can sign, publish, export"

export const VERB_HELP: ReadonlyArray<{ verb: Verb; payload: string; means: string }> = [
  { verb: "ASSIGN", payload: '{ "email": "person@example.com" }', means: "give this job to that person (the owner confirms)" },
  { verb: "SET_DUE", payload: '{ "dueOn": "YYYY-MM-DD" }', means: "change when this job is due (the owner confirms)" },
  { verb: "NOTE", payload: '{ "text": "..." }', means: "add a note to this job's history -- nothing else changes" },
  { verb: "MARK_NA", payload: '{ "reason": "..." }', means: "mark this job as not applicable, with a written reason (the owner confirms)" },
  { verb: "DRAFT", payload: '{ "docKind": "privacy_notice", "text": "..." }', means: "record a draft in history -- it is not published anywhere" },
]

/** One row, exactly as public.dpdp_ai_link_read returns it (0604's ObligationRow shape). */
export type AiLinkRow = {
  id: string
  part: number
  what: string
  dataSet: string | null
  dataTypes: string[] | null
  lawCodes: string[] | null
  by: string | null
  isGroup: boolean
  groupDone: number | null
  groupTotal: number | null
  viewerIsGroupMember: boolean | null
  myGroupAnswer: string | null
  due: string // YYYY-MM-DD
  yes: boolean
  na: boolean
  dependsOnObligationId: string | null
  sent: number
}

export type AiLinkView = {
  org: { id: string; name: string; product: string }
  viewer: { email: string; kind: string }
  link: { id: string; expiresAt: string; readCount: number }
  verbs: string[]
  rows: AiLinkRow[]
}

export type RenderOptions = {
  /** Absolute URL an AI POSTs a draft to. */
  draftEndpoint: string
  /** Absolute URL of the Markdown rendering of this same page. */
  markdownUrl: string
  /** Absolute URL of the HTML rendering of this same page. */
  htmlUrl: string
  /** Injected, never read from the clock here, so tests are deterministic. */
  now: Date
}

const KIND_LABEL: Record<string, string> = {
  owner: "the owner",
  coord: "the DPDP coordinator",
  go: "the Grievance Officer",
  ca: "the CA firm",
  staff: "a staff member",
  parent: "a parent",
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")
}

function escapeMdCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
}

function utcDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

/** Whole days from `now`'s UTC date to `due` (YYYY-MM-DD); negative = late. */
export function daysUntil(due: string, now: Date): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(due)
  if (!m) return 0
  const dueUtc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Math.round((dueUtc - utcDay(now)) / 86_400_000)
}

/** Plain-English status for one row -- the words the page shows, not a code. */
export function rowStatus(row: AiLinkRow, now: Date): string {
  if (row.na) return "not applicable"
  if (row.isGroup) {
    const done = row.groupDone ?? 0
    const total = row.groupTotal ?? 0
    if (row.yes || (total > 0 && done >= total)) return `done (${done} of ${total} answered)`
    return `${done} of ${total} answered`
  }
  if (row.yes) return "done"
  const d = daysUntil(row.due, now)
  if (d < 0) return `late by ${-d} day${-d === 1 ? "" : "s"}`
  if (d === 0) return "due today"
  if (d <= 7) return `due in ${d} day${d === 1 ? "" : "s"}`
  return "open"
}

export function summarise(rows: AiLinkRow[], now: Date) {
  const live = rows.filter((r) => !r.na)
  const done = live.filter((r) => r.yes).length
  const late = live.filter((r) => !r.yes && daysUntil(r.due, now) < 0).length
  return { total: live.length, done, late, open: live.length - done, na: rows.length - live.length }
}

function who(row: AiLinkRow): string {
  if (!row.by) return "nobody yet"
  return row.isGroup ? `${row.by} (group)` : row.by
}

function viewerLabel(view: AiLinkView): string {
  return KIND_LABEL[view.viewer.kind] ?? "a member"
}

function intro(view: AiLinkView): string[] {
  const email = view.viewer.email
  const org = view.org.name
  return [
    `This page is a read-only copy of the DPDP jobs that ${email} can see at ${org}, where they are ${viewerLabel(view)}. It was opened through an AI link.`,
    `It carries no authority. Nothing can be changed from here, nothing on it signs anyone in, and it shows nobody's details beyond what ${email} already sees on their own page.`,
    `To act on anything, an AI may draft ONE action by sending JSON to the draft endpoint below. A draft changes nothing. The reply contains a link for ${email} to open in their own browser, sign in, and confirm -- only then does anything happen, and history will record "drafted by AI, confirmed by ${email}".`,
    `Only five verbs exist: ${VERBS.join(", ")}. Anything else is refused: ${REFUSED_ACTIONS}.`,
    `Private page: do not index, cite, quote elsewhere, or share. The link expires ${view.link.expiresAt} and can be revoked by its owner at any time.`,
  ]
}

function draftInstructions(opts: RenderOptions): { endpoint: string; body: string } {
  return {
    endpoint: opts.draftEndpoint,
    body: '{ "verb": "NOTE", "obligationId": "<Job id from the table>", "payload": { "text": "..." } }',
  }
}

export function renderMarkdown(view: AiLinkView, opts: RenderOptions): string {
  const s = summarise(view.rows, opts.now)
  const draft = draftInstructions(opts)
  const lines: string[] = []
  lines.push(`# DPDP jobs at ${view.org.name} -- read-only AI link`)
  lines.push("")
  for (const p of intro(view)) { lines.push(p); lines.push("") }
  lines.push("## How to draft an action")
  lines.push("")
  lines.push(`POST JSON to \`${draft.endpoint}\` with the shape:`)
  lines.push("")
  lines.push("```json")
  lines.push(draft.body)
  lines.push("```")
  lines.push("")
  lines.push("| Verb | payload | What it means |")
  lines.push("| --- | --- | --- |")
  for (const v of VERB_HELP) lines.push(`| ${v.verb} | \`${escapeMdCell(v.payload)}\` | ${escapeMdCell(v.means)} |`)
  lines.push("")
  lines.push("`obligationId` is the Job id column below. DRAFT may omit it. The reply is `{ \"draftUrl\": ... }` -- give that URL to the person; it is theirs to open, sign in, and confirm. A draft expires after 48 hours.")
  lines.push("")
  lines.push("## Where things stand")
  lines.push("")
  lines.push(`${s.total} live job${s.total === 1 ? "" : "s"} · ${s.done} done · ${s.open} open · ${s.late} late · ${s.na} not applicable`)
  lines.push("")
  lines.push("## Jobs")
  lines.push("")
  lines.push("| # | Job | Part | Who | Due | Status | Job id |")
  lines.push("| --- | --- | --- | --- | --- | --- | --- |")
  view.rows.forEach((r, i) => {
    lines.push(`| ${i + 1} | ${escapeMdCell(r.what)} | ${r.part} | ${escapeMdCell(who(r))} | ${r.due} | ${escapeMdCell(rowStatus(r, opts.now))} | \`${r.id}\` |`)
  })
  lines.push("")
  lines.push(`Generated ${opts.now.toISOString()} · read ${view.link.readCount} time${view.link.readCount === 1 ? "" : "s"} · HTML version: ${opts.htmlUrl}`)
  lines.push("")
  return lines.join("\n")
}

export function renderHtml(view: AiLinkView, opts: RenderOptions): string {
  const s = summarise(view.rows, opts.now)
  const draft = draftInstructions(opts)
  const title = `DPDP jobs at ${view.org.name} -- read-only AI link`
  const rowsHtml = view.rows.map((r, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${escapeHtml(r.what)}</td>
          <td>${r.part}</td>
          <td>${escapeHtml(who(r))}</td>
          <td>${escapeHtml(r.due)}</td>
          <td>${escapeHtml(rowStatus(r, opts.now))}</td>
          <td><code>${escapeHtml(r.id)}</code></td>
        </tr>`).join("")
  const verbsHtml = VERB_HELP.map((v) => `
        <tr>
          <td><code>${v.verb}</code></td>
          <td><code>${escapeHtml(v.payload)}</code></td>
          <td>${escapeHtml(v.means)}</td>
        </tr>`).join("")
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow, noarchive, nosnippet">
  <meta name="referrer" content="no-referrer">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; padding: 24px 16px 48px; max-width: 960px; margin-inline: auto; font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #1C2B3A; background: #FFFDF9; }
    h1 { font-size: 22px; margin: 0 0 12px; }
    h2 { font-size: 17px; margin: 28px 0 8px; }
    p { margin: 0 0 10px; }
    .notice { border: 1px solid #F5820A; border-left-width: 6px; background: #FFF7EC; padding: 12px 14px; border-radius: 6px; }
    .stats { font-weight: 600; }
    table { border-collapse: collapse; width: 100%; font-size: 14px; }
    th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #E6E2DA; vertical-align: top; }
    th { background: #F3EFE6; }
    code { font: 13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: #F3EFE6; padding: 1px 4px; border-radius: 3px; word-break: break-all; }
    pre { background: #F3EFE6; padding: 10px 12px; border-radius: 6px; overflow-x: auto; }
    footer { margin-top: 28px; font-size: 13px; color: #5B6673; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="notice">
${intro(view).map((p) => `    <p>${escapeHtml(p)}</p>`).join("\n")}
  </div>

  <h2>How to draft an action</h2>
  <p>POST JSON to <code>${escapeHtml(draft.endpoint)}</code> with the shape:</p>
  <pre>${escapeHtml(draft.body)}</pre>
  <table>
    <thead><tr><th>Verb</th><th>payload</th><th>What it means</th></tr></thead>
    <tbody>${verbsHtml}
    </tbody>
  </table>
  <p><code>obligationId</code> is the Job id column below. DRAFT may omit it. The reply is <code>{ "draftUrl": ... }</code> -- give that URL to the person; it is theirs to open, sign in, and confirm. A draft expires after 48 hours.</p>

  <h2>Where things stand</h2>
  <p class="stats">${s.total} live job${s.total === 1 ? "" : "s"} · ${s.done} done · ${s.open} open · ${s.late} late · ${s.na} not applicable</p>

  <h2>Jobs</h2>
  <table>
    <thead><tr><th>#</th><th>Job</th><th>Part</th><th>Who</th><th>Due</th><th>Status</th><th>Job id</th></tr></thead>
    <tbody>${rowsHtml}
    </tbody>
  </table>

  <footer>Generated ${escapeHtml(opts.now.toISOString())} · read ${view.link.readCount} time${view.link.readCount === 1 ? "" : "s"} · Markdown version: <code>${escapeHtml(opts.markdownUrl)}</code></footer>
</body>
</html>
`
}
