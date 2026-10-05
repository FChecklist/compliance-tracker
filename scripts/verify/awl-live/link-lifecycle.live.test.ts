/// <reference types="bun-types" />
// Audit 100, checklist rows B44 (link expiry and revoke work at once), B54 (header-token mode works), B43 (the no-browse paste card and the
// draft that the person confirms), A32 (paste into a free chat AI that cannot open links) and A35 (work link = API = access token = link):
// the DEPLOYED function, with throwaway links of people of the e2e test organisation.
//
//   LIFECYCLE  a link answers 200; the moment it is revoked the very next call is 410; a link whose expiry time has passed is 410 too;
//              neither the MCP endpoint nor the card pages serve a dead link.
//   HEADER MODE the same link given as a header (Link-Token, or Authorization: Bearer) at /header answers exactly what the path form
//              answers; a token in a query string is refused 400 (it would end up in logs); a wrong header token is refused.
//   CARD       the token-free paste card (card.md, at most 8,000 bytes) and its data page (card-data.md, at most 100,000 bytes, project
//              links only) are served as Markdown and tell the chat AI how to answer with a projexa-proposal block.
//   REACHABILITY the repository's own eight-check script (scripts/verify/awl-reachability.sh: link length, no redirect, IPv4, robots, the
//              ChatGPT fetcher's user agent, Markdown content type, CORS preflight, token-free card) passes 8 of 8 on a fresh link.
//   DRAFT      a create_project draft answers 201 with a confirm address on a REAL host (not the "never resolves" default), that page is up,
//              the draft is "awaiting_confirmation", and NOTHING was created: the project does not exist until the person confirms in PROJEXA.
// Writes: one draft row (it expires by itself and changes no business data) and, for the expiry test, the expiry time of a link made here.
// Run: bun test --isolate ./scripts/verify/awl-live/link-lifecycle.live.test.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { AWL_BASE, PEOPLE, call, expectPerson, jsonHeaders, liveEnabled, mgmtSql, mintProjectLink, mintThrowaway, redact, revoke, type Throwaway } from "./live-lib"

setDefaultTimeout(120_000)

const MERIDIAN = "dd486dad-9119-4d9a-a9d9-cf0ee0cc9e04"
const DRAFT_NAME = "AUDIT100 draft must never exist"

describe.skipIf(!liveEnabled())("link lifecycle, header mode, paste card and draft (live)", () => {
  let user: Throwaway // user link of a second manager: header mode, expiry
  let project: Throwaway // project link: card data
  let member: Throwaway // a second member: the draft
  const all = () => [user, project, member].filter(Boolean)

  beforeAll(async () => {
    await expectPerson(PEOPLE.manager2, "manager")
    await expectPerson(PEOPLE.member2, "member")
    user = await mintThrowaway(PEOPLE.manager2, "audit100 lifecycle")
    project = await mintProjectLink(PEOPLE.manager2, MERIDIAN, "audit100 card")
    member = await mintThrowaway(PEOPLE.member2, "audit100 draft")
  }, 300_000)

  afterAll(async () => {
    for (const l of all()) await revoke(l.id)
  })

  // -------------------------------------------------------------------------------------------------------------- HEADER MODE
  test("HEADER MODE: Link-Token and Authorization: Bearer answer exactly what the path form answers", async () => {
    const viaPath = await call(`${user.url}/context`, { headers: jsonHeaders })
    expect(viaPath.status).toBe(200)
    const viaLinkToken = await call(`${AWL_BASE}/header/context`, { headers: { ...jsonHeaders, "link-token": user.token } })
    const viaBearer = await call(`${AWL_BASE}/header/context`, { headers: { ...jsonHeaders, authorization: `Bearer ${user.token}` } })
    for (const r of [viaLinkToken, viaBearer]) {
      expect(r.status).toBe(200)
      expect(r.json.acting_for).toEqual(viaPath.json.acting_for)
      expect(r.json.level).toBe(viaPath.json.level)
      expect(r.json.scope).toBe("user")
    }
    // and it reaches data, not just the context
    const projects = await call(`${AWL_BASE}/header/projects`, { headers: { ...jsonHeaders, "link-token": user.token } })
    expect(projects.status).toBe(200)
    expect(projects.json.total).toBeGreaterThan(5)
  })

  test("HEADER MODE: a token in a query string is refused 400, and a wrong or missing header token is refused", async () => {
    for (const q of ["token", "key", "api_key"]) {
      const r = await call(`${AWL_BASE}/header/context?${q}=${user.token}`, { headers: jsonHeaders })
      expect(r.status, `?${q}=`).toBe(400)
      expect(r.text).not.toContain(user.token)
    }
    const wrong = await call(`${AWL_BASE}/header/context`, { headers: { ...jsonHeaders, "link-token": "pxa_" + "1".repeat(64) } })
    expect([404, 410]).toContain(wrong.status)
    const none = await call(`${AWL_BASE}/header/context`, { headers: jsonHeaders })
    expect([400, 401, 403, 404, 410]).toContain(none.status)
    expect(none.text).not.toContain("acting_for")
  })

  test("HEADER MODE: the header-mode API documents carry no token and declare the two header schemes", async () => {
    const o = await call(`${AWL_BASE}/header/openapi.json`, { headers: { ...jsonHeaders, "link-token": user.token } })
    expect(o.status).toBe(200)
    expect(o.json.servers).toEqual([{ url: `${AWL_BASE}/header` }])
    expect(o.json.components.securitySchemes.linkToken).toEqual({ type: "apiKey", in: "header", name: "Link-Token" })
    expect(o.json.components.securitySchemes.bearer).toEqual({ type: "http", scheme: "bearer" })
    expect(o.text).not.toContain("pxa_")
  })

  // ------------------------------------------------------------------------------------------------------------------- CARD
  test("CARD: card.md is Markdown under 8,000 bytes and teaches the projexa-proposal block; card-data.md is under 100,000 bytes", async () => {
    const card = await call(`${project.url}/card.md`)
    expect(card.status).toBe(200)
    expect(card.headers.get("content-type")).toContain("text/plain")
    expect(new TextEncoder().encode(card.text).length).toBeLessThanOrEqual(8_000)
    expect(card.text).toContain("projexa-proposal")
    expect(card.text).not.toContain(project.token) // the card is token-free: it is meant to be pasted into a chat
    expect(card.text).toContain("Do not write programs, scripts, SQL or code")

    const data = await call(`${project.url}/card-data.md?kinds=project,tasks`)
    expect(data.status).toBe(200)
    expect(data.headers.get("content-type")).toContain("text/plain")
    expect(new TextEncoder().encode(data.text).length).toBeLessThanOrEqual(100_000)
    expect(data.text).toContain("Meridian Heights")
    expect(data.text).not.toContain(project.token)
  })

  test("CARD: a link for all projects has no card data (it must name a project first) - the paste card always uses a project link", async () => {
    const r = await call(`${user.url}/card-data.md?kinds=project`)
    expect(r.status).toBe(400)
    expect(r.json.code).toBe("PROJECT_REQUIRED")
  })

  // ---------------------------------------------------------------------------------------------------------------- REACHABILITY
  test("REACHABILITY: scripts/verify/awl-reachability.sh passes all 8 checks (H04-H08, H16, H17, H19) on a fresh link", () => {
    const gitBash = "C:\\Program Files\\Git\\bin\\bash.exe"
    const bash = existsSync(gitBash) ? gitBash : "bash"
    const script = join(import.meta.dir, "..", "awl-reachability.sh")
    const r = spawnSync(bash, [script.replaceAll("\\", "/")], { encoding: "utf8", timeout: 240_000, env: { ...process.env, AWL_LINK: user.url } })
    const out = redact(`${r.stdout ?? ""}${r.stderr ?? ""}`)
    expect(out).toContain("AWL_REACH passed=8 failed=0")
    expect(r.status).toBe(0)
    expect(out).not.toContain(user.token)
  })

  // ------------------------------------------------------------------------------------------------------------------ DRAFT
  test("DRAFT: create_project is a draft that waits for the person; the confirm page host is real and up; nothing is created", async () => {
    const d = await call(`${member.url}/drafts`, { method: "POST", idempotent: false, headers: jsonHeaders, body: JSON.stringify({ function: "create_project", params: { name: DRAFT_NAME } }) })
    expect(d.status).toBe(201)
    expect(d.json.status).toBe("awaiting_confirmation")
    expect(d.json.function).toBe("create_project")
    expect(d.json.note).toContain("Nothing has changed")

    const confirm = new URL(d.json.confirm_url)
    expect(confirm.host).not.toBe("confirm-host-not-set.invalid")
    expect(confirm.protocol).toBe("https:")
    // the confirm code travels in the fragment only, so it never reaches a server log
    expect(confirm.hash.startsWith(`#d=${d.json.draft_id}.`)).toBe(true)
    expect(confirm.search).toBe("")
    const page = await call(confirm.origin + confirm.pathname)
    expect(page.status).toBe(200)
    expect(page.headers.get("content-type")).toContain("text/html")

    const state = await call(`${member.url}/drafts/${d.json.draft_id}`, { headers: jsonHeaders })
    expect(state.status).toBe(200)
    expect(state.json.status).toBe("awaiting_confirmation")
    expect(state.json.confirmed_at).toBeNull()
    expect(state.json.executed_at).toBeNull()

    // the independent proof: the database has no such project, and no submission
    const [p] = await mgmtSql<{ n: number }>(`select count(*)::int as n from compliance.projects where name = '${DRAFT_NAME}'`)
    expect(p.n).toBe(0)
  })

  test("DRAFT: confirming needs a signed-in person - the confirm route refuses a call with no session", async () => {
    const r = await call(`${AWL_BASE}/drafts/00000000000000000000000000000000/confirm`, { method: "POST", idempotent: true, headers: jsonHeaders, body: JSON.stringify({ code: "0000" }) })
    expect([400, 401, 403, 404]).toContain(r.status)
    // and a link token is not a session: it must not be accepted as one
    const asLink = await call(`${AWL_BASE}/drafts/00000000000000000000000000000000/confirm`, { method: "POST", idempotent: true, headers: { ...jsonHeaders, authorization: `Bearer ${member.token}` }, body: JSON.stringify({ code: "0000" }) })
    expect([400, 401, 403]).toContain(asLink.status)
  })

  // ------------------------------------------------------------------------------------------------------------------ LIFECYCLE
  test("LIFECYCLE: a link whose expiry time has passed answers 410 at once (and its card too)", async () => {
    expect((await call(`${project.url}/context`, { headers: jsonHeaders })).status).toBe(200)
    await mgmtSql(`update platform.user_ai_links set expires_at = now() - interval '1 minute' where id = '${project.id}'`)
    const after = await call(`${project.url}/context`, { headers: jsonHeaders })
    expect(after.status).toBe(410)
    expect(after.json.error).toContain("expired or was revoked")
    expect((await call(`${project.url}/card.md`)).status).toBe(410)
    expect((await call(project.url)).status).toBe(410)
  })

  test("LIFECYCLE: revoking makes the very next call 410 on every door (guide, REST, header mode, MCP, card)", async () => {
    expect((await call(user.url)).status).toBe(200)
    await revoke(user.id)
    expect((await call(user.url)).status).toBe(410)
    expect((await call(`${user.url}/context`, { headers: jsonHeaders })).status).toBe(410)
    expect((await call(`${AWL_BASE}/header/context`, { headers: { ...jsonHeaders, "link-token": user.token } })).status).toBe(410)
    expect((await call(`${user.url}/card.md`)).status).toBe(410)
    const mcp = await call(user.url, { method: "POST", idempotent: true, headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) })
    expect(mcp.status).toBe(410)
    expect(mcp.text).not.toContain("list_projects")
    const [row] = await mgmtSql<{ status: string; revoked_at: string | null }>(`select status, revoked_at from platform.user_ai_links where id = '${user.id}'`)
    expect(row.status).toBe("revoked")
    expect(row.revoked_at).not.toBeNull()
  })

  test("LIFECYCLE: the two other links are revoked at the end and then answer 410", async () => {
    await revoke(project.id)
    await revoke(member.id)
    expect((await call(`${member.url}/context`, { headers: jsonHeaders })).status).toBe(410)
    expect((await call(`${project.url}/context`, { headers: jsonHeaders })).status).toBe(410)
  })
})
