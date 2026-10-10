/// <reference types="bun-types" />
// The reader edition: a person pastes ONE prompt with ONE address, and an engine that opens only addresses the person typed (ChatGPT, Gemini ...) must be able to
// keep working from what that address returned, because it cannot open any other. So for such an engine the pasted address returns the workspace (every project,
// its BOQ, the menu, the confirm-link recipe) with a short briefing on top. Anything else (Claude, curl, a tool) still gets the full guide; ?edition= overrides.
import { describe, expect, test } from "bun:test"
import { isReaderEngine } from "../../../supabase/functions/_shared/ai-link/core"
import { handleAwl } from "../../../supabase/functions/ai-work-link/handler"
import { MENU_AREAS } from "../../../supabase/functions/ai-work-link/api-definition"
import { TOKENS, makeFake, req, testConfig } from "../services/__test-helpers__/awl-edge-fake"

const CHATGPT = "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot"
const CLAUDE = "Mozilla/5.0 (compatible; Claude-User/1.0; +Claude-User@anthropic.com)"

async function get(path: string, ua: string): Promise<{ status: number; text: string; robots: string | null; type: string | null }> {
  const r = await handleAwl(req(path, { headers: { "user-agent": ua } }), { rpc: makeFake({}).rpc, config: testConfig(), log: () => {} })
  return { status: r.status, text: await r.text(), robots: r.headers.get("x-robots-tag"), type: r.headers.get("content-type") }
}

describe("who is a reader engine", () => {
  test("engines that open only typed addresses are; Claude, tools and unknowns are not", () => {
    expect(isReaderEngine(CHATGPT)).toBe(true)
    expect(isReaderEngine("Mozilla/5.0 (compatible; Google-NotebookLM)")).toBe(true)
    expect(isReaderEngine(CLAUDE)).toBe(false)
    expect(isReaderEngine("curl/8.4.0")).toBe(false)
    expect(isReaderEngine("python-requests/2.31")).toBe(false)
    expect(isReaderEngine("")).toBe(false)
    expect(isReaderEngine(null)).toBe(false)
  })
})

describe("the pasted address", () => {
  test("ChatGPT gets one page that holds everything: briefing, menu, ending, every project and its BOQ, the confirm recipe", async () => {
    const r = await get(`/${TOKENS.userManager}`, CHATGPT)
    expect(r.status).toBe(200)
    expect(r.text.startsWith("# Everything in one page: all your projects")).toBe(true)
    expect(r.text).toContain("## Briefing (read this first)")
    expect(r.text).toContain("do not try to open any other address")
    for (let i = 0; i < MENU_AREAS.length; i++) expect(r.text).toContain(`${i + 1} ${MENU_AREAS[i]}`)
    expect(r.text).toContain("End every answer with three lines: DONE")
    expect(r.text).toContain("### Project 1")
    expect(r.text).toContain("### Project 2")
    expect(r.text).toContain("BOQ versions (newest first)")
    expect(r.text).toContain("BOQ lines")
    expect(r.text).toContain("What I can do for you")
    expect(new TextEncoder().encode(r.text).length).toBeLessThan(100000)
    expect(r.type).toContain("text/")
    // a document an engine may quote: not nosnippet (Gemini may refuse such a page)
    expect(r.robots).not.toContain("nosnippet")
  })

  test("Claude, curl and unknown callers still get the full guide", async () => {
    for (const ua of [CLAUDE, "curl/8.4.0", ""]) {
      const r = await get(`/${TOKENS.userManager}`, ua)
      expect(r.status).toBe(200)
      expect(r.text).toContain("## A. Who you work for")
      expect(r.text).not.toContain("## Briefing (read this first)")
    }
  })

  test("?edition=full gives ChatGPT the full guide, ?edition=reader gives anyone the reader page", async () => {
    const full = await get(`/${TOKENS.userManager}?edition=full`, CHATGPT)
    expect(full.text).toContain("## A. Who you work for")
    const reader = await get(`/${TOKENS.userManager}?edition=reader`, "curl/8.4.0")
    expect(reader.text).toContain("## Briefing (read this first)")
  })

  test("a link for one project gets the same reader page for that project", async () => {
    const r = await get(`/${TOKENS.manager}`, CHATGPT)
    expect(r.status).toBe(200)
    expect(r.text.startsWith("# Everything in one page: this project")).toBe(true)
    expect(r.text).toContain("## Briefing (read this first)")
    expect(r.text).toContain("BOQ versions (newest first)")
  })

  test("the address is still refused for a wrong token, whatever the caller", async () => {
    const r = await get(`/pxa_${"0".repeat(64)}`, CHATGPT)
    expect(r.status).toBeGreaterThanOrEqual(404)
    expect(r.text).not.toContain("Briefing")
  })
})
