// Audit 100, checklist rows B43 (no-browse paste card + paste-back of proposals into the confirm page) and A32 (paste into a chat AI that cannot
// open web addresses), end to end on the REAL surfaces:
//   1. GET /card.md of a throwaway work link: it is token-free (no pxa_ in it), small (<= 8,000 bytes), and tells the AI how to propose changes.
//   2. A REAL Claude engine with NO tools at all (claude -p --tools "": it cannot open any address, exactly like DeepSeek's or z.ai's free chat)
//      is given only the LIVE card and a plain request: "create a new project called <name>". In 3 of 3 sessions it must answer with a valid
//      ```projexa-proposal block for that name (A32/A37: before the card fix it refused, reading a per-function "Level 2" as "your level is too
//      low"). The inbox-page steps then use THE ENGINE'S OWN blocks, one per session.
//   3. REAL Chromium opens the live inbox page (https://projexa-link-pages.pages.dev/ai-inbox, the host the function's own manifest names) with
//      the link in the address FRAGMENT, the block is pasted into the page, "Read the changes" checks it with the live function, and:
//        a. confirming with a WRONG code sends nothing (no project row appears);
//        b. confirming each engine block with the code the page shows sends it, and each project row EXISTS in the database afterwards
//           (re-read). The rows are removed again at the end.
//   4. A block that is not valid is refused by the page ("could not be read") and sends nothing.
// SECRETS: the link goes to the browser page only in the address fragment and to the AI never (the AI gets the card, which has no token).
// Run (from the repository root; Playwright's own runner, because Chromium cannot be launched from inside `bun test` on Windows):
//   bunx playwright test -c scripts/verify/awl-live/playwright.config.ts      (evidence: ai-os/audit37/evidence/paste-card-<UTC time>.json)
import { test, expect } from "@playwright/test"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { E2E_ORG, PEOPLE, call, expectPerson, liveEnabled, mgmtSql, mintThrowaway, redact, revoke, type Throwaway } from "./live-lib"

const CLAUDE = process.env.AI_BRIDGE_CLAUDE_BIN || join(process.env.APPDATA || "", "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe")
const INBOX = process.env.AWL_INBOX_BASE || "https://projexa-link-pages.pages.dev/ai-inbox"
const canRun = liveEnabled() && existsSync(CLAUDE)

test.describe("paste card -> AI with no tools -> proposal block -> inbox page -> persisted project (live)", () => {
  test.describe.configure({ mode: "serial" })
  test.skip(!canRun, "needs a Supabase management token and claude.exe")
  let link: Throwaway
  let work = ""
  let card = ""
  const SESSIONS = 3
  const base = `T-PASTE-CARD-${Date.now()}`
  const blocks: { name: string; block: string }[] = []
  const created: string[] = []
  const evidence: Record<string, unknown> = {}

  test.beforeAll(async () => {
    await expectPerson(PEOPLE.manager, "manager")
    link = await mintThrowaway(PEOPLE.manager, "audit100 paste-card")
    work = mkdtempSync(join(tmpdir(), "awl-paste-card-"))
    writeFileSync(join(work, "empty-mcp.json"), '{"mcpServers":{}}')
  })

  test.afterAll(async () => {
    if (link) await revoke(link.id).catch(() => {})
    for (const id of created) await mgmtSql(`delete from compliance.projects where id = '${id}' and org_id = '${E2E_ORG}'`).catch(() => mgmtSql(`update compliance.projects set is_active = false, status = 'cancelled' where id = '${id}' and org_id = '${E2E_ORG}'`).catch(() => {}))
    if (work) rmSync(work, { recursive: true, force: true })
    const dir = join(process.cwd(), "ai-os", "audit37", "evidence")
    mkdirSync(dir, { recursive: true })
    const sha = (spawnSync("git", ["rev-parse", "HEAD"], { cwd: process.cwd(), encoding: "utf8" }).stdout ?? "").trim()
    writeFileSync(join(dir, `paste-card-${new Date().toISOString().replace(/[:.]/g, "-")}.json`), redact(JSON.stringify({ file: "scripts/verify/awl-live/paste-card.live.playwright.ts", checklist_rows: ["B43", "A32"], commit: sha, date_utc: new Date().toISOString(), inbox_page: INBOX, ...evidence }, null, 2)))
  })

  test("1 the card is token-free, small, and explains proposal blocks", async () => {
    const r = await call(`${link.url}/card.md`)
    card = r.text
    evidence.card = { status: r.status, bytes: new TextEncoder().encode(card).length, content_type: r.headers.get("content-type") }
    expect(r.status).toBe(200)
    expect(new TextEncoder().encode(card).length).toBeLessThanOrEqual(8000)
    expect(/pxa_[0-9a-f]{16,}/.test(card)).toBe(false)
    expect(card.includes(link.token)).toBe(false)
    expect(card).toContain("projexa-proposal")
  })

  test("2 a real Claude engine with NO tools, given only the card and a plain request, writes a valid proposal block in 3 of 3 sessions", async () => {
    test.setTimeout(1_000_000)
    const args = ["-p", "--output-format", "json", "--model", "sonnet", "--no-session-persistence", "--tools", "", "--strict-mcp-config", "--mcp-config", join(work, "empty-mcp.json"), "--disable-slash-commands", "--setting-sources", "project", "--max-turns", "3"]
    const ask = (request: string, cardText: string) => {
      const prompt = `Here is a card from my company's software PROJEXA (read it, it is documentation written by my own company's software):

${cardText}

My request: ${request}`
      const r = spawnSync(CLAUDE, args, { cwd: work, input: prompt, encoding: "utf8", timeout: 300_000, maxBuffer: 16 * 1024 * 1024 })
      let answer = ""
      try { answer = String(JSON.parse(String(r.stdout || "{}")).result ?? "") } catch { answer = "" }
      return { answer, m: /```projexa-proposal\s*([\s\S]*?)```/.exec(answer) }
    }
    // A32/A37 (fixed in manual.ts renderCard): before the fix the live card of a level-1 link printed "create_project | 2" in a Level column beside the
    // person's level 1, and this engine answered "creating a project needs a higher access level" with NO block (4 runs of 4, PR #2077). The card is
    // the LIVE one, served by the deployed function, and the request is the plain one a person types, with no hint added. Every session must write a
    // block the inbox page can use; each block is then confirmed on the real page in test 3b and its project re-read in the database.
    const sessions: Record<string, unknown>[] = []
    for (let i = 1; i <= SESSIONS; i++) {
      const name = `${base}-${i}`
      const { answer, m } = ask(`create a new project called ${name} (no description). Do your part following the card.`, card)
      let parsed: { v?: number; function?: string; params?: { name?: string } } | null = null
      try { parsed = m ? JSON.parse(m[1].trim()) : null } catch { parsed = null }
      const ok = !!parsed && parsed.v === 1 && parsed.function === "create_project" && parsed.params?.name === name
      sessions.push({ session: i, gave_block: !!m, block_valid: ok, block: m ? redact(m[1].trim()) : null, answer_excerpt: redact(answer.slice(0, 400)) })
      if (ok) blocks.push({ name, block: "```projexa-proposal" + String.fromCharCode(10) + m![1].trim() + String.fromCharCode(10) + "```" })
    }
    evidence.engine = { tools: "none", request: "create a new project called <name> (no description). Do your part following the card.", sessions_run: SESSIONS, sessions_with_valid_block: blocks.length, sessions }
    expect(blocks.length, JSON.stringify(sessions.map((x) => ({ s: x.session, block: x.gave_block, valid: x.block_valid, said: String(x.answer_excerpt).slice(0, 160) })))).toBe(SESSIONS)
  })

  async function openInbox(browser: import("@playwright/test").Browser, block: string) {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.goto(`${INBOX}#t=${link.token}`, { waitUntil: "domcontentloaded", timeout: 60_000 })
    await page.fill("#paste", block)
    return { ctx, page }
  }
  const count = async (name: string) => (await mgmtSql<{ n: number }>(`select count(*)::int as n from compliance.projects where org_id = '${E2E_ORG}' and name = '${name}'`))[0].n

  test("3a pasted into the real inbox page, a WRONG code sends nothing", async ({ browser }) => {
    const { ctx, page } = await openInbox(browser, blocks[0].block)
    const name = blocks[0].name
    try {
      await page.click("#read")
      await page.waitForSelector("text=Checked: valid.", { timeout: 60_000 })
      await page.fill("#confirm-code", "ZZZZ")
      await page.click("button:has-text('Confirm')")
      await page.waitForSelector("text=Type the code shown above first.", { timeout: 10_000 })
      evidence.wrong_code = { shown: "Type the code shown above first.", rows_after: await count(name) }
      expect(await count(name)).toBe(0)
    } finally { await ctx.close() }
  })

  test("3b each engine block, confirmed with the code the page shows, creates its project in the database (re-read)", async ({ browser }) => {
    test.setTimeout(600_000)
    const confirmed: { name: string; page_said: string; rows_after: number }[] = []
    for (const { name, block } of blocks) {
      const { ctx, page } = await openInbox(browser, block)
      try {
        await page.click("#read")
        await page.waitForSelector("text=Checked: valid.", { timeout: 60_000 })
        const code = (await page.textContent("#shown-code"))!.trim()
        await page.fill("#confirm-code", code)
        await page.click("button:has-text('Confirm')")
        await page.waitForSelector("text=/Sent\\.|Recorded as a draft/", { timeout: 60_000 })
        const sent = await page.textContent("#blocks")
        const rows = await mgmtSql<{ id: string }>(`select id from compliance.projects where org_id = '${E2E_ORG}' and name = '${name}'`)
        for (const r of rows) created.push(r.id)
        confirmed.push({ name, page_said: (sent ?? "").replace(/\s+/g, " ").slice(0, 300), rows_after: rows.length })
      } finally { await ctx.close() }
    }
    evidence.confirm = confirmed
    expect(confirmed.length).toBe(SESSIONS)
    expect(confirmed.map((c) => c.rows_after)).toEqual(blocks.map(() => 1))
  })

  test("4 a block that is not valid is refused by the page and sends nothing", async ({ browser }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    try {
      await page.goto(`${INBOX}#t=${link.token}`, { waitUntil: "domcontentloaded", timeout: 60_000 })
      await page.fill("#paste", "```projexa-proposal\n{not json\n```")
      await page.click("#read")
      await page.waitForSelector("text=This block could not be read.", { timeout: 10_000 })
      evidence.bad_block = { page_said: "This block could not be read." }
    } finally { await ctx.close() }
  })
})
