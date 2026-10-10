// AUDIT-100 (2026-10-06): live check after deploying ai-work-link: a THROWAWAY user link (revoked at the end) GETs the guide twice (200 text/plain, the inline
// "Your projects" list, X-Robots-Tag noindex, nofollow, the footer), /projects, /workspace and /workspace.txt. Prints a redacted JSON summary.
// Run: bun scripts/verify/awl-live/postdeploy-inline-workspace.live.ts
import { PEOPLE, mintThrowaway, revoke, linkStatus, redact } from "./live-lib"
const out: Record<string, unknown> = { at: new Date().toISOString() }
const t = await mintThrowaway(PEOPLE.reader, "audit100 inline list postdeploy")
out.link_id = t.id
try {
  for (const n of [1, 2]) {
    const t0 = Date.now()
    const r = await fetch(t.url, { headers: { "user-agent": "curl/8 audit100-postdeploy" }, signal: AbortSignal.timeout(30000) })
    const body = await r.text()
    out[`guide_${n}`] = { status: r.status, ms: Date.now() - t0, ctype: r.headers.get("content-type"), robots: r.headers.get("x-robots-tag"), bytes: new TextEncoder().encode(body).length,
      has_inline: body.includes("## Your projects (read now, so you can show the list without another request)"), rows: (body.match(/^\{"n":/gm) ?? []).length,
      report_line: /^- \d+\. Report on all above/m.test(body), step_one: body.includes("If the list below is present"), footer: body.includes("## All addresses"), workspace_pointer: body.includes("/workspace)") }
  }
  const p = await fetch(t.url + "/projects", { signal: AbortSignal.timeout(30000) })
  out.projects = { status: p.status, robots: p.headers.get("x-robots-tag") }
  const t1 = Date.now()
  const w = await fetch(t.url + "/workspace", { signal: AbortSignal.timeout(60000) })
  const wb = await w.text()
  out.workspace = { status: w.status, ms: Date.now() - t1, ctype: w.headers.get("content-type"), robots: w.headers.get("x-robots-tag"), bytes: new TextEncoder().encode(wb).length,
    sections: ["## Your projects", "## Report on all projects", "### Project 1", "## What I can do for you", "## All addresses"].map((s) => [s, wb.includes(s)]), not_read: (wb.match(/could not be read right now/g) ?? []).length, more: /more projects?: open/.test(wb) }
  const wt = await fetch(t.url + "/workspace.txt", { signal: AbortSignal.timeout(60000) })
  out.workspace_txt = { status: wt.status, disposition: wt.headers.get("content-disposition") }
  await wt.text()
} finally {
  await revoke(t.id)
  out.revoked = await linkStatus(t.id)
}
console.log(redact(JSON.stringify(out, null, 1)))
