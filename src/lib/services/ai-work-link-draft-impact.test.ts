/// <reference types="bun-types" />
// lf-b5-ai-crud -- THE BLAST RADIUS a person sees before confirming an organisation change (supabase/functions/ai-work-link/drafts.ts draftPreview).
// A BOQ category's rename rewrites the category of every BOQ line of the organisation that carries it, on every project; the preview says how many
// lines and projects, from public.ai_work_link_draft_impact (drizzle/0687; its SQL is proven on PGlite in ai-work-link-b5.pglite.test.ts).
//   * a rename draft: the preview carries `impact` with the counts and one sentence the confirm page prints ("... on 3 BOQ lines across 2 projects");
//   * a retire draft of a category in use says it cannot be retired while lines use it; an unused one says no line uses it;
//   * the impact is asked with the SAME draft id, person and confirm code the preview was given (never another person's);
//   * any other function never asks for an impact; a failing or odd impact answer shows the preview without it (never a 5xx).
// WHAT IS REAL: draftPreview and its session and person gates. WHAT IS INJECTED: the session verifier and the rpc (the database), as the handler's own deps.
// Run: bun test --isolate src/lib/services/ai-work-link-draft-impact.test.ts
import { describe, expect, test } from "bun:test"
import { draftPreview, impactSummary, IMPACT_FUNCTIONS } from "../../../supabase/functions/ai-work-link/drafts"
import type { Rpc } from "../../../supabase/functions/ai-work-link/reads"
import type { SessionVerifier } from "../../../supabase/functions/ai-work-link/session"

const session: SessionVerifier = async (token) => (token === "sess-mgr" ? { ok: true, sub: "sub-mgr", email: null, issuer: "test", iat: null } : { ok: false, reason: "invalid" })

type Calls = Array<{ name: string; args: Record<string, unknown> }>

function rpcFor(fn: string, params: Record<string, unknown>, impact: unknown | "throw", calls: Calls): Rpc {
  return async (name, args = {}) => {
    calls.push({ name, args: args as Record<string, unknown> })
    if (name === "projexa_read_resolve_user") return { data: [{ user_id: "u-mgr" }], error: null }
    if (name === "ai_work_link_draft_state") return { data: { status: "ok", draft: { id: "d1", function_id: fn, params, state: "awaiting_confirmation", writes_enabled: true } }, error: null }
    if (name === "ai_work_link_draft_impact") {
      if (impact === "throw") throw new Error("boom")
      return { data: impact, error: null }
    }
    return { data: null, error: { message: `unexpected ${name}` } }
  }
}

async function preview(fn: string, params: Record<string, unknown>, impact: unknown | "throw") {
  const calls: Calls = []
  const req = new Request("https://x.supabase.co/functions/v1/ai-work-link/drafts/d1/preview", {
    method: "POST", headers: { authorization: "Bearer sess-mgr", "content-type": "application/json" }, body: JSON.stringify({ confirmToken: "code-1" }),
  })
  const answer = await draftPreview(req, "d1", { rpc: rpcFor(fn, params, impact, calls), session, log: () => {} })
  return { answer, body: answer.body as Record<string, any>, calls }
}

describe("the draft preview shows the blast radius of a BOQ category change", () => {
  test("a rename: the counts and one sentence, asked with this draft, this person and this confirm code", async () => {
    const impact = { status: "ok", impact: { kind: "boq_category", function_id: "rename_boq_category", category: "Civil", new_name: "Civil works", lines: 3, projects: 2 } }
    const { answer, body, calls } = await preview("rename_boq_category", { categoryId: "bcat_civil", name: "Civil works" }, impact)
    expect(answer.status).toBe(200)
    expect(body.impact).toEqual({
      kind: "boq_category", category: "Civil", new_name: "Civil works", lines: 3, projects: 2,
      summary: 'Renames the category "Civil" to "Civil works" on 3 BOQ lines across 2 projects of your organisation.',
    })
    expect(calls.find((c) => c.name === "ai_work_link_draft_impact")!.args).toEqual({ p_draft_id: "d1", p_actor_user_id: "u-mgr", p_confirm_token: "code-1" })
  })

  test("a retire: in use, it says it cannot be retired; unused, it says no line uses it; one line and one project read in the singular", async () => {
    const used = await preview("delete_boq_category", { categoryId: "c" }, { status: "ok", impact: { kind: "boq_category", function_id: "delete_boq_category", category: "Paint", new_name: null, lines: 1, projects: 1 } })
    expect(used.body.impact.summary).toBe('The category "Paint" is used by 1 BOQ line on 1 project: it cannot be retired while they use it.')
    const unused = await preview("delete_boq_category", { categoryId: "c" }, { status: "ok", impact: { kind: "boq_category", function_id: "delete_boq_category", category: "Misc", new_name: null, lines: 0, projects: 0 } })
    expect(unused.body.impact.summary).toBe('Retires the category "Misc"; no BOQ line uses it.')
  })

  test("any other function never asks for an impact and carries none", async () => {
    const { body, calls } = await preview("update_vendor", { vendorId: "v" }, { status: "ok", impact: { category: "x", lines: 9, projects: 9, function_id: "update_vendor" } })
    expect(body.impact).toBeUndefined()
    expect(calls.some((c) => c.name === "ai_work_link_draft_impact")).toBe(false)
    expect([...IMPACT_FUNCTIONS].sort()).toEqual(["delete_boq_category", "rename_boq_category"])
  })

  test("a failing, refused or odd impact answer shows the preview without it (200, never a 5xx)", async () => {
    for (const impact of ["throw", { status: "refused", reason: "not_owner" }, { status: "ok", impact: null }, { status: "ok", impact: { category: 7 } }] as const) {
      const { answer, body } = await preview("rename_boq_category", { categoryId: "c", name: "N" }, impact)
      expect({ impact, status: answer.status, has: "impact" in body }).toEqual({ impact, status: 200, has: false })
      expect(body.can_confirm).toBe(true)
    }
  })

  test("impactSummary: a rename of a category no line uses says so", () => {
    expect(impactSummary({ function_id: "rename_boq_category", category: "Facade", new_name: "Facades", lines: 0, projects: 0 })).toBe('Renames the category "Facade" to "Facades"; no BOQ line uses it yet.')
  })
})
