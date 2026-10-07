/// <reference types="bun-types" />
// The AI's briefing, made hard to get wrong (docs/connectors/AI_SITEMAP_SUMEET_111.md in projexa): the first page carries the numbered menu and the
// DONE / NEXT / ASK ending, section M gives one recipe per menu area, every function a recipe names is a real registry function and is only named on
// a link that has it, and the wording about asking permission follows the link's own level (it used to say "do not ask permission" on a link that
// can only propose).
import { describe, expect, test } from "bun:test"
import { LINK_FUNCTIONS } from "../../../supabase/functions/ai-work-link/api-definition"
import { MENU_AREAS, RECIPES, recipeText, renderManualMarkdown, type ManualInput } from "../../../supabase/functions/ai-work-link/manual"
import { effectiveFunctionViews, type AwlConfig, type LinkCtx } from "../../../supabase/functions/ai-work-link/reads"

const F = "https://x.supabase.co/functions/v1/ai-work-link"
const config: AwlConfig = { functionBase: F, confirmHost: "confirm.example.pages.dev", appBase: "https://app.example", addressPosition: null, execPresent: true }
const ids = LINK_FUNCTIONS.map((f) => f.function_id)

function manual(level: number, writes: boolean, scope: "project" | "user", fns: string[] = ids): string {
  const ctx: LinkCtx = {
    link_id: "l", org_id: "o", user_id: "u", user_name: "Asha", project_id: scope === "project" ? "p" : null, project_name: scope === "project" ? "Tower" : null,
    live_role: "manager", live_rank: 3, authority_level: level, allowed_functions: fns, effective_level: level, effective_functions: fns, money_visible: true,
    hide_personal: false, label: null, expires_at: "2026-10-27T00:00:00Z", writes_enabled: writes,
  } as unknown as LinkCtx
  const input: ManualInput = { base: `${F}/pxa_${"b".repeat(64)}`, mode: "path", token: "pxa_" + "b".repeat(64), config, ctx, functions: effectiveFunctionViews({ ctx, config }) }
  return renderManualMarkdown(input)
}

describe("the menu and the recipes are tied to the real registry", () => {
  test("eleven areas, and exactly one recipe per area", () => {
    expect(MENU_AREAS.length).toBe(11)
    expect(RECIPES.map((r) => r.area)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
  })

  test("every backticked name in a recipe is a registry function, except the one named field", () => {
    const registry = new Set(ids)
    const unknown = RECIPES.flatMap((r) => [...r.text.matchAll(/`([a-z_]+)`/g)].map((m) => m[1])).filter((n) => !registry.has(n) && n !== "idempotency_key")
    expect(unknown).toEqual([])
  })

  test("a recipe never names a function the link lacks", () => {
    const all = new Set(ids)
    const lacking = new Set([...all].filter((i) => i !== "delete_boq"))
    const text = recipeText(RECIPES[1].text, lacking)
    expect(text).not.toContain("delete_boq")
    expect(text).toContain("create_boq")
    expect(recipeText(RECIPES[1].text, new Set())).not.toMatch(/`create_boq`/)
  })
})

describe("what the AI is told", () => {
  for (const scope of ["user", "project"] as const) {
    test(`${scope} link: the first page has the numbered menu and the ending, and section M is there`, () => {
      const md = manual(0, true, scope)
      const start = md.slice(0, md.indexOf("## A."))
      expect(start).toContain("Show this numbered menu and wait")
      for (let i = 0; i < MENU_AREAS.length; i++) expect(start).toContain(`${i + 1} ${MENU_AREAS[i]}`)
      expect(start).toContain("End every answer with three lines: DONE")
      const M = md.slice(md.indexOf("## M."))
      expect(M).toContain("You never do the maths")
      expect(M).toContain("Never override a block unless the person says")
      expect(M).toContain("You cannot upload a file")
    })
  }

  test("a link that can only propose never tells the AI to act without asking permission", () => {
    for (const scope of ["user", "project"] as const) {
      const md = manual(0, false, scope)
      expect(md).not.toContain("without asking permission for any step")
      expect(md).not.toContain("None needs a yes first")
      expect(md).not.toContain("Do not ask permission for any step")
      expect(md).toContain("draft the person confirms")
    }
  })

  test("a link with direct changes still says so", () => {
    const md = manual(1, true, "project")
    expect(md).toContain("you may add, edit and delete records in this project")
    expect(md).toContain("without asking permission for any step")
  })

  test("section L tells the AI how to look any function up in full", () => {
    const md = manual(0, true, "project")
    const L = md.slice(md.indexOf("## L."), md.indexOf("## M."))
    expect(L).toContain("/functions?fn=<id>")
    expect(L).toContain("describe_function")
  })

  test("a link made before newer functions existed says so, a complete link does not", () => {
    const old = manual(0, true, "project", ids.slice(0, 20))
    expect(old).toContain("This link was made with 20 functions and")
    expect(old).toContain("the newer ones are not on it")
    expect(manual(0, true, "project")).not.toContain("the newer ones are not on it")
  })

  for (const scope of ["user", "project"] as const) {
    test(`${scope} link: an AI that cannot open an address is told to relay it and never to invent the data, and where the whole picture is`, () => {
      const md = manual(0, true, scope)
      const start = md.slice(0, md.indexOf("## A."))
      expect(start).toContain("If you cannot open an address this guide gives you")
      expect(start).toContain("never invent the data")
      expect(start).toContain("paste it back as their next message")
      expect(start).toMatch(/\/workspace: read it first/)
      // the Start here box stays about ten lines
      const box = md.indexOf("> **Start here.**")
      expect(md.slice(box, md.indexOf("\n\n", box)).split("\n").length).toBeLessThanOrEqual(10)
    })
  }
})
