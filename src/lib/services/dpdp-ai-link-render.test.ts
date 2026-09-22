/// <reference types="bun-types" />
// WO-DPDP-012 §7: pure unit tests for the AI link page renderer
// (supabase/functions/dpdp-ai-link/render.ts). No database, no Deno, no
// clock -- `now` is injected. Lives under src/ (not next to render.ts)
// because bunfig.toml's `[test] root = "src"` is the only place a bare
// `bun test --isolate` (CI's invocation) discovers files.
import { describe, expect, test } from "bun:test"
import {
  renderHtml, renderMarkdown, rowStatus, summarise, daysUntil, escapeHtml, VERBS, REFUSED_ACTIONS,
  type AiLinkRow, type AiLinkView,
} from "../../../supabase/functions/dpdp-ai-link/render"

const NOW = new Date("2026-09-22T09:00:00Z")

function row(over: Partial<AiLinkRow> & { id: string; what: string; due: string }): AiLinkRow {
  return {
    part: 1, dataSet: null, dataTypes: null, lawCodes: null, by: null, isGroup: false,
    groupDone: null, groupTotal: null, viewerIsGroupMember: null, myGroupAnswer: null,
    yes: false, na: false, dependsOnObligationId: null, sent: 0,
    ...over,
  }
}

const view: AiLinkView = {
  org: { id: "org1", name: "Sharma & <Sons> LLP", product: "firm" },
  viewer: { email: "priya@example.test", kind: "staff" },
  link: { id: "link1", expiresAt: "2026-09-29T09:00:00Z", readCount: 3 },
  verbs: [...VERBS],
  rows: [
    row({ id: "ob-done", what: "Name a DPDP coordinator", due: "2026-09-01", by: "priya@example.test", yes: true }),
    row({ id: "ob-late", what: "Publish a privacy | policy", due: "2026-09-20", by: "priya@example.test", part: 3 }),
    row({ id: "ob-group", what: "Lock your laptop", due: "2026-10-30", by: "All staff", isGroup: true, groupDone: 2, groupTotal: 5, viewerIsGroupMember: true, part: 4 }),
    row({ id: "ob-na", what: "Bus firm agreement", due: "2026-10-30", na: true, part: 5 }),
  ],
}

const opts = {
  draftEndpoint: "https://x.supabase.co/functions/v1/dpdp-ai-link/tok/draft",
  markdownUrl: "https://x.supabase.co/functions/v1/dpdp-ai-link/tok.md",
  htmlUrl: "https://x.supabase.co/functions/v1/dpdp-ai-link/tok",
  now: NOW,
}

describe("daysUntil / rowStatus / summarise", () => {
  test("counts whole UTC days and words late/soon/open the way the page shows them", () => {
    expect(daysUntil("2026-09-22", NOW)).toBe(0)
    expect(daysUntil("2026-09-20", NOW)).toBe(-2)
    expect(daysUntil("2026-09-29", NOW)).toBe(7)
    expect(rowStatus(view.rows[0], NOW)).toBe("done")
    expect(rowStatus(view.rows[1], NOW)).toBe("late by 2 days")
    expect(rowStatus(view.rows[2], NOW)).toBe("2 of 5 answered")
    expect(rowStatus(view.rows[3], NOW)).toBe("not applicable")
    expect(rowStatus(row({ id: "x", what: "x", due: "2026-09-22" }), NOW)).toBe("due today")
    expect(rowStatus(row({ id: "x", what: "x", due: "2026-09-25" }), NOW)).toBe("due in 3 days")
    expect(rowStatus(row({ id: "x", what: "x", due: "2026-12-25" }), NOW)).toBe("open")
  })
  test("summarise excludes not-applicable rows from the live count", () => {
    expect(summarise(view.rows, NOW)).toEqual({ total: 3, done: 1, open: 2, late: 1, na: 1 })
  })
})

describe("renderHtml", () => {
  const html = renderHtml(view, opts)
  test("is private and clean: noindex meta, no <script>, no external resource, inline CSS only", () => {
    expect(html).toContain('<meta name="robots" content="noindex, nofollow, noarchive, nosnippet">')
    expect(html).toContain('<meta name="referrer" content="no-referrer">')
    expect(html).not.toMatch(/<script/i)
    expect(html).not.toMatch(/<link\s/i)
    expect(html).not.toMatch(/<img\s/i)
    expect(html).not.toMatch(/src=|@import|url\(/i)
    expect(html).toContain("<style>")
  })
  test("states at the top what it is, that it is read-only, that the person confirms in their browser, and the five verbs", () => {
    const top = html.slice(0, html.indexOf("<h2>"))
    expect(top).toContain("read-only copy of the DPDP jobs that priya@example.test can see")
    expect(top).toContain("It carries no authority")
    expect(top).toContain("open in their own browser, sign in, and confirm")
    expect(top).toContain("drafted by AI, confirmed by priya@example.test")
    for (const v of VERBS) expect(top).toContain(v)
    expect(top).toContain(REFUSED_ACTIONS)
    expect(top).toContain("do not index, cite")
  })
  test("escapes untrusted text and prints every job id, who, and status", () => {
    expect(html).toContain("Sharma &amp; &lt;Sons&gt; LLP")
    expect(html).not.toContain("<Sons>")
    expect(html).toContain("<code>ob-late</code>")
    expect(html).toContain("All staff (group)")
    expect(html).toContain("nobody yet")
    expect(html).toContain("late by 2 days")
    expect(html).toContain(opts.draftEndpoint)
    expect(html).toContain("3 live jobs · 1 done · 2 open · 1 late · 1 not applicable")
  })
})

describe("renderMarkdown", () => {
  const md = renderMarkdown(view, opts)
  test("carries the same plain statements and verbs as the HTML", () => {
    expect(md.startsWith("# DPDP jobs at Sharma & <Sons> LLP -- read-only AI link")).toBe(true)
    expect(md).toContain("It carries no authority")
    expect(md).toContain("open in their own browser, sign in, and confirm")
    for (const v of VERBS) expect(md).toContain(`| ${v} |`)
    expect(md).toContain(REFUSED_ACTIONS)
    expect(md).toContain("POST JSON to `" + opts.draftEndpoint + "`")
  })
  test("renders one table row per job with the id in the last column, escaping pipes", () => {
    expect(md).toContain("| 2 | Publish a privacy \\| policy | 3 | priya@example.test | 2026-09-20 | late by 2 days | `ob-late` |")
    expect(md).toContain("| 3 | Lock your laptop | 4 | All staff (group) | 2026-10-30 | 2 of 5 answered | `ob-group` |")
    expect(md).toContain("| 4 | Bus firm agreement | 5 | nobody yet | 2026-10-30 | not applicable | `ob-na` |")
    expect(md).toContain("read 3 times")
    expect(md).toContain(opts.htmlUrl)
  })
  test("never contains a script tag or an HTML entity leak", () => {
    expect(md).not.toMatch(/<script/i)
    expect(md).not.toContain("&amp;")
  })
})

describe("escapeHtml", () => {
  test("escapes the five characters that matter", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;")
  })
})
