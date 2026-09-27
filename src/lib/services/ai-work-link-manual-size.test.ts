// BUILD-002 AW-310 (WP-05): the manual stays inside its size budget when the link carries EVERY function of the registry, not the ten a fixture
// usually gives it. The manual prints a grouped catalogue (ids by module, with paging) instead of a row per function, which is what keeps it small.
import { describe, test, expect } from "bun:test"
import { LIMITS } from "../../../supabase/functions/_shared/ai-link/core"
import { LINK_FUNCTIONS, KIND_NAMES } from "../../../supabase/functions/ai-work-link/api-definition"
import { effectiveFunctionViews, type AwlConfig, type LinkCtx } from "../../../supabase/functions/ai-work-link/reads"
import { renderCard, renderManualMarkdown, type ManualInput } from "../../../supabase/functions/ai-work-link/manual"

const F = "https://example.supabase.co/functions/v1/ai-work-link"
const enc = new TextEncoder()
const config: AwlConfig = { functionBase: F, confirmHost: "confirm.example.pages.dev", appBase: "https://app.example", addressPosition: null, execPresent: true }

function input(rank: number, functionIds: string[], extra: Partial<LinkCtx> = {}): ManualInput {
  const ctx: LinkCtx = {
    link_id: "lnk_1", org_id: "org_1", user_id: "u_1", user_name: "Sumeet", project_id: "proj_1", project_name: "ZOOMIES",
    live_role: rank >= 3 ? "manager" : rank === 2 ? "member" : "viewer", live_rank: rank, authority_level: 2,
    allowed_functions: functionIds, effective_level: 2, effective_functions: functionIds, money_visible: rank >= 3,
    hide_personal: false, label: null, expires_at: "2026-10-27T00:00:00Z", writes_enabled: true, ...extra,
  }
  const token = "pxa_" + "a".repeat(64)
  const functions = effectiveFunctionViews({ ctx, config })
  return { base: `${F}/${token}`, mode: "path", token, config, ctx, functions }
}

describe("the manual with the whole function registry", () => {
  const all = LINK_FUNCTIONS.map((f) => f.function_id)

  test("the registry on links is big enough that this test means something", () => {
    expect(all.length).toBeGreaterThanOrEqual(90)
  })

  test("a manager's manual with every function is under the 20,000-byte budget and names every function id", () => {
    const md = renderManualMarkdown(input(3, all))
    expect(enc.encode(md).length).toBeLessThan(LIMITS.manualMaxBytes)
    for (const id of all) expect(md).toContain(id)
    for (const k of KIND_NAMES) expect(md).toContain(k)
  })

  test("the Markdown manual with every function is under the budget for manager, member and viewer (the JSON form is not budgeted: it carries the manifest a second time)", () => {
    for (const rank of [3, 2, 1]) {
      const md = renderManualMarkdown(input(rank, all))
      expect(enc.encode(md).length).toBeLessThan(LIMITS.manualMaxBytes)
    }
  })

  test("a very long project name and label cannot push the full-catalogue manual over the budget", () => {
    const md = renderManualMarkdown(input(3, all, { project_name: "n".repeat(5000), label: "l".repeat(5000) }))
    expect(enc.encode(md).length).toBeLessThan(LIMITS.manualMaxBytes)
  })

  test("the paste card with every function stays inside its own budget", () => {
    const card = renderCard(input(3, all))
    expect(enc.encode(card).length).toBeLessThanOrEqual(LIMITS.cardMaxBytes)
  })
})
