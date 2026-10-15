/// <reference types="bun-types" />
// Audit 37 (owner design 2026-10-04): the manual is the AI's whole briefing. For a user-scope and a project-scope link it must lead with a short
// "Start here" box, say who the AI is, say what PROJEXA is, give step-by-step recipes and the reports guidance, and list every function from the
// registry; and (owner requirement 13) the no-code / no-invented-address rule must be in the manual AND the card. Text only: nothing here checks authorization.
// Run: bun test --isolate src/lib/services/ai-work-link-manual-guide.test.ts
import { describe, test, expect } from "bun:test"
import { LIMITS } from "../../../supabase/functions/_shared/ai-link/core"
import { LINK_FUNCTIONS } from "../../../supabase/functions/ai-work-link/api-definition"
import { handleAwl } from "../../../supabase/functions/ai-work-link/handler"
import { RULES, renderCard, renderManualMarkdown, type ManualInput } from "../../../supabase/functions/ai-work-link/manual"
import { effectiveFunctionViews, type AwlConfig, type LinkCtx } from "../../../supabase/functions/ai-work-link/reads"
import { F, TOKENS, makeFake, req, testConfig } from "./__test-helpers__/awl-edge-fake"

const enc = new TextEncoder()
const NO_CODE_PHRASES = ["Do not write programs, scripts, SQL or code", "do not guess, invent or build any web address or endpoint", "say in everyday words that you cannot do that here"]

async function get(token: string, rest = ""): Promise<string> {
  const fake = makeFake({})
  const r = await handleAwl(req(`/${token}${rest}`), { rpc: fake.rpc, config: testConfig(), log: () => {} })
  return await r.text()
}

function headings(md: string): string[] {
  return md.split("\n").filter((l) => l.startsWith("## ")).map((l) => l.slice(3))
}

describe("the manual of a user-scope link and of a project-scope link", () => {
  for (const [name, token] of [["user", TOKENS.userManager], ["project", TOKENS.manager]] as const) {
    test(`${name} link: Start here box first, then the new sections I to L, no token in a card, within the size budget`, async () => {
      const md = await get(token)
      const box = md.indexOf("> **Start here.**")
      expect(box).toBeGreaterThan(-1)
      expect(box).toBeLessThan(md.indexOf("## A."))
      // the box is about ten lines, not a page
      const boxLines = md.slice(box, md.indexOf("\n\n", box)).split("\n")
      expect(boxLines.length).toBeLessThanOrEqual(10)
      expect(boxLines.every((l) => l.startsWith(">"))).toBe(true)
      for (const h of ["I. What PROJEXA is", "J. How to work: step by step", "K. Reports and analysis", "L. Every function you can use"]) expect(headings(md).some((x) => x.startsWith(h))).toBe(true)
      expect(md).toContain("**Who you are.**")
      expect(md).toContain("via AI assistant")
      expect(md).toContain("construction and interior-design")
      expect(md).toContain("run_named_report")
      expect(md).toContain("get_project_analysis")
      // the old anchors other tooling relies on are still there, in order
      expect(md.indexOf("## C.")).toBeLessThan(md.indexOf("## H. Manifest"))
      expect(md.indexOf("## H. Manifest")).toBeLessThan(md.indexOf("## I."))
      expect(enc.encode(md).length).toBeLessThan(LIMITS.manualMaxBytes)
      // the card holds no token
      expect(await get(token, "/card.md")).not.toContain("pxa_")
    })

    test(`${name} link: the no-code rule is in the manual and in the card, with the same number`, async () => {
      const md = await get(token)
      const card = await get(token, "/card.md")
      for (const p of NO_CODE_PHRASES) {
        expect(md).toContain(p)
        expect(card).toContain(p)
      }
      const n = RULES.findIndex((r) => r.includes(NO_CODE_PHRASES[0])) + 1
      expect(n).toBe(RULES.length)
      expect(md).toContain(`\n${n}. Do not write programs`)
      expect(card).toContain(`\n${n}. Do not write programs`)
    })
  }

  test("the function list is generated from the registry: a user link names every registry function (but create_project is the draft in section C), and a project link names exactly its own", async () => {
    const user = await get(TOKENS.userManager)
    const L = user.slice(user.indexOf("## L."))
    for (const f of LINK_FUNCTIONS) if (f.function_id !== "create_project") expect(L).toContain(`\`${f.function_id}\``)
    expect(L).toContain("delete_boq")
    const deletes = LINK_FUNCTIONS.filter((f) => /^(delete_|remove_|void_|archive_|cancel_)/.test(f.function_id)).map((f) => f.function_id)
    const A = user.slice(user.indexOf("## A."), user.indexOf("## B."))
    for (const d of deletes) expect(A).toContain(`\`${d}\``)

    const project = await get(TOKENS.manager)
    const PL = project.slice(project.indexOf("## L."))
    const cfg: AwlConfig = testConfig()
    const manifest = JSON.parse(project.slice(project.indexOf("```json ai-link-manifest\n") + 25, project.indexOf("\n```", project.indexOf("```json ai-link-manifest"))))
    for (const id of manifest.allowed_functions as string[]) expect(PL).toContain(`\`${id}\``)
    // a function the link does not carry is not listed
    const notOnLink = LINK_FUNCTIONS.map((f) => f.function_id).filter((id) => !(manifest.allowed_functions as string[]).includes(id))
    for (const id of notOnLink.slice(0, 5)) expect(PL).not.toContain(`\`${id}\``)
    expect(cfg).toBeDefined()
  })

  test("the direct-change wording follows the link's own level and never claims more", () => {
    const config: AwlConfig = { functionBase: F, confirmHost: "confirm.example.pages.dev", appBase: "https://app.example", addressPosition: null, execPresent: true }
    const ids = LINK_FUNCTIONS.map((f) => f.function_id)
    const mk = (level: number, writes: boolean): ManualInput => {
      const ctx: LinkCtx = {
        link_id: "l", org_id: "o", user_id: "u", user_name: "Asha", project_id: "p", project_name: "Tower", live_role: "manager", live_rank: 3,
        authority_level: level, allowed_functions: ids, effective_level: level, effective_functions: ids, money_visible: true, hide_personal: false,
        label: null, expires_at: "2026-10-27T00:00:00Z", writes_enabled: writes,
      }
      return { base: `${F}/pxa_${"b".repeat(64)}`, mode: "path", token: "pxa_" + "b".repeat(64), config, ctx, functions: effectiveFunctionViews({ ctx, config }) }
    }
    const direct = renderManualMarkdown(mk(1, true))
    expect(direct).toContain("you may add, edit and delete records in this project")
    const draftOnly = renderManualMarkdown(mk(0, true))
    expect(draftOnly).not.toContain("you may add, edit and delete records")
    expect(draftOnly).toContain("only proposes changes")
    expect(renderCard({ ctx: mk(1, true).ctx, functions: mk(1, true).functions })).not.toContain("pxa_")
  })
})
