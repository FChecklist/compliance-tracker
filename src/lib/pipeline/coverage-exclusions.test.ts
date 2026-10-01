// BUILD-002 AW-311 (WP-05): after nine coverage waves put ~94 functions on links, the classes that must stay off every link still are:
// model calls (F-2), organisation-wide reads (F-3), personal HR ids that cannot be checked against a project, and
// anything that deletes, holds a secret or belongs to the platform admin. (Creating another project is no longer in the list: a link made for a PERSON
// may draft create_project, a level 2 draft the person confirms; a link made for ONE PROJECT never can, which the SQL effective list proves in
// ai-work-link-user-link.pglite.test.ts.) A wave that allow-lists one of them, or a later edit that drops its reason,
// fails here by name.
import { describe, test, expect } from "bun:test"
import { buildFunctionRows } from "../../../scripts/gen-ai-link-registry"
import { EXCLUDED_REASONS, LINK_FUNCTIONS } from "../../../scripts/gen-ai-link-registry.data"
import { ALL_FUNCTION_SPECS } from "@/lib/pipeline/function-registry"
import registry from "../../../supabase/functions/ai-work-link/function-registry.generated.json"

type Row = { function_id: string; link_level: number | null; excluded_reason: string | null }
const rows = registry as Row[]
const onLinks = rows.filter((r) => r.link_level !== null).map((r) => r.function_id)
const excludedIds = Object.keys(EXCLUDED_REASONS)

describe("what stays off every link", () => {
  test("every excluded function is generated with no link level and its written reason", () => {
    expect(excludedIds.length).toBeGreaterThanOrEqual(18)
    for (const id of excludedIds) {
      const row = rows.find((r) => r.function_id === id)
      expect(row, id).toBeDefined()
      expect(row!.link_level, id).toBeNull()
      expect(row!.excluded_reason, id).toBe(EXCLUDED_REASONS[id])
      expect(EXCLUDED_REASONS[id].length, id).toBeGreaterThan(20)
    }
  })

  test("no excluded function is allow-listed on links, in the data file or in the generated registry", () => {
    for (const id of excludedIds) {
      expect(id in LINK_FUNCTIONS, id).toBe(false)
      expect(onLinks.includes(id), id).toBe(false)
    }
  })

  test("model calls stay off: the two functions that call a server-side model have the F-2 reason", () => {
    for (const id of ["generate_construction_progress_summary", "detect_construction_budget_schedule_risk"]) {
      expect(EXCLUDED_REASONS[id]).toContain("server-side model")
      expect(onLinks.includes(id)).toBe(false)
    }
  })

  test("organisation-wide reads stay off: every list of the whole organisation has the F-3 reason", () => {
    const orgWide = excludedIds.filter((id) => /Organisation|whole organisation/.test(EXCLUDED_REASONS[id]))
    expect(orgWide.length).toBeGreaterThanOrEqual(14)
    for (const id of ["list_delayed_activities", "list_over_budget_projects", "get_compliance_stats", "list_customers", "list_leads", "list_gst_returns"]) {
      expect(orgWide).toContain(id)
    }
  })

  test("a link cannot link an employee (organisation-wide HR record); create_project is on links ONLY as a level 2 draft of a link made for a person", () => {
    expect(onLinks).not.toContain("link_roster_employee")
    const cp = (registry as Array<Row & { min_role_rank: number; kind: string }>).find((r) => r.function_id === "create_project")!
    expect(cp).toMatchObject({ link_level: 2, min_role_rank: 2, kind: "write", excluded_reason: null })
    expect("create_project" in EXCLUDED_REASONS).toBe(false)
  })

  test("no function on a link is a delete, a secret, a credential, a platform-admin or a model function by name", () => {
    const forbidden = /(^|_)(delete|purge|drop|secret|credential|password|api_key|apikey|token_rotate|platform|admin|impersonate|llm|model_call)(_|$)/
    const offenders = onLinks.filter((id) => forbidden.test(id))
    expect(offenders).toEqual([])
  })

  test("the generator refuses to allow-list an excluded function (a wave cannot slip one in)", () => {
    const id = excludedIds[0]
    const policy = { [id]: { linkLevel: 0, moneySensitive: false, minRank: 1, textParams: [] as string[] } }
    expect(() => buildFunctionRows(ALL_FUNCTION_SPECS, policy as never, EXCLUDED_REASONS)).toThrow("both allow-listed and excluded")
  })
})
