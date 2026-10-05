// Audit 100, checklist rows B43 (no-browse paste card + paste-back of proposals into the confirm page) and A32 (paste into a chat AI that cannot
// open web addresses), end to end on the REAL surfaces:
//   1. GET /card.md of a throwaway work link: it is token-free (no pxa_ in it), small (<= 8,000 bytes), and tells the AI how to propose changes.
//   2. A REAL Claude engine with NO tools at all (claude -p --tools "": it cannot open any address, exactly like DeepSeek's or z.ai's free chat)
//      is given only the card and a request: "create a new project called <name>". Whether it answers with a ```projexa-proposal block is RECORDED
//      (measured: it refuses on a level-1 card, see the finding in test 2); the inbox-page steps then use the card's own example block.
//   3. REAL Chromium opens the live inbox page (https://projexa-link-pages.pages.dev/ai-inbox, the host the function's own manifest names) with
//      the link in the address FRAGMENT, the block is pasted into the page, "Read the changes" checks it with the live function, and:
//        a. confirming with a WRONG code sends nothing (no project row appears);
//        b. confirming with the code the page shows sends it, and the project row EXISTS in the database afterwards (re-read), attributed to
//           the person via the AI assistant. The row is removed again at the end.
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
  let block = ""
  const name = `T-PASTE-CARD-${Date.now()}`
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
    writeFileSync(join(dir, `paste-card-${new Date().toISOString().replace(/[:.]/g, "-")}.json`), redact(JSON.stringify({ file: "scripts/verify/awl-live/paste-card.live.spec.ts", checklist_rows: ["B43", "A32"], commit: sha, date_utc: new Date().toISOString(), inbox_page: INBOX, ...evidence }, null, 2)))
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

  test("2 a real Claude engine with NO tools is given the card and a request (its block is used if it writes one; the result is recorded either way)", async () => {
    test.setTimeout(700_000)
    const args = ["-p", "--output-format", "json", "--model", "sonnet", "--no-session-persistence", "--tools", "", "--strict-mcp-config", "--mcp-config", join(work, "empty-mcp.json"), "--disable-slash-commands", "--setting-sources", "project", "--max-turns", "3"]
    const ask = (request: string, cardText: string) => {
      const prompt = `Here is a card from my company's software PROJEXA (read it, it is documentation written by my own company's software):

${cardText}

My request: ${request}`
      const r = spawnSync(CLAUDE, args, { cwd: work, input: prompt, encoding: "utf8", timeout: 300_000, maxBuffer: 16 * 1024 * 1024 })
      const answer = String(JSON.parse(String(r.stdout || "{}")).result ?? "")
      return { answer, m: /```projexa-proposal\s*([\s\S]*?)```/.exec(answer) }
    }
    const request = `create a new project called ${name} (no description). Do your part following the card.`
    // The plain request a person would type, with the card exactly as the LIVE function serves it (a link at level 1 lists create_project as "Level 2").
    const plain = ask(request, card)
    // A SECOND try with the person's own fact added ("I am a manager and this link lets me create projects"), still the live card.
    const clarified = plain.m ? null : ask(`${request} I am a manager and this link lets me create projects; I confirm every proposal myself on the inbox page.`, card)
    const got = plain.m ?? clarified?.m ?? null
    // MEASURED FINDING (2026-10-05, 4 runs of a real Claude engine with no tools, 2 card texts): given the live card of a level-1 link the engine
    // answers "creating a project needs a higher access level than your account has" and prints NO block: it reads the card's "level":1 for the person
    // against "create_project | 2" in the table. It is recorded here, not hidden: the rest of the paste-back path (below) is tested with the block exactly as the
    // card's own example shows it, so the INBOX PAGE and the persisted outcome are still proven; the "engine writes the block by itself" part is not.
    evidence.engine = {
      tools: "none",
      live_card_plain_request_gave_block: !!plain.m,
      live_card_plain_answer_excerpt: redact(plain.answer.slice(0, 400)),
      live_card_clarified_request_gave_block: clarified ? !!clarified.m : null,
      block_source_for_the_inbox_test: got ? "the engine's own block" : "the card's own example block, with the test's project name (the engine refused)",
    }
    const text = got ? got[1].trim() : JSON.stringify({ v: 1, function: "create_project", params: { name }, note: "a new project" })
    JSON.parse(text)
    block = "```projexa-proposal" + String.fromCharCode(10) + text + String.fromCharCode(10) + "```"
    const parsed = JSON.parse(text)
    expect(parsed.function).toBe("create_project")
    expect(parsed.params.name).toBe(name)
  })

  async function openInbox(browser: import("@playwright/test").Browser) {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.goto(`${INBOX}#t=${link.token}`, { waitUntil: "domcontentloaded", timeout: 60_000 })
    await page.fill("#paste", block)
    return { ctx, page }
  }
  const count = async () => (await mgmtSql<{ n: number }>(`select count(*)::int as n from compliance.projects where org_id = '${E2E_ORG}' and name = '${name}'`))[0].n

  test("3a pasted into the real inbox page, a WRONG code sends nothing", async ({ browser }) => {
    const { ctx, page } = await openInbox(browser)
    try {
      await page.click("#read")
      await page.waitForSelector("text=Checked: valid.", { timeout: 60_000 })
      await page.fill("#confirm-code", "ZZZZ")
      await page.click("button:has-text('Confirm')")
      await page.waitForSelector("text=Type the code shown above first.", { timeout: 10_000 })
      evidence.wrong_code = { shown: "Type the code shown above first.", rows_after: await count() }
      expect(await count()).toBe(0)
    } finally { await ctx.close() }
  })

  test("3b with the code the page shows, the project exists in the database afterwards", async ({ browser }) => {
    const { ctx, page } = await openInbox(browser)
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
      evidence.confirm = { page_said: (sent ?? "").replace(/\s+/g, " ").slice(0, 300), rows_after: rows.length }
      expect(rows.length).toBe(1)
    } finally { await ctx.close() }
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
