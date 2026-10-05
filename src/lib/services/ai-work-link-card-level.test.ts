// Audit 100, A32/A37: the PASTE CARD (GET <link>/card.md, supabase/functions/ai-work-link/manual.ts renderCard) must never tell a person's AI that
// a function needs a HIGHER level than the person has. Measured with a real Claude engine with no tools (PR #2077): the card of a level-1 link
// printed `create_project | 2` in a "Function | Level | Required" table beside the person's `level: 1`, and the engine answered "creating a
// project needs a higher access level than your account has" and wrote no proposal block, 4 runs out of 4. It was not true: a proposal block is
// a DRAFT the person confirms on the inbox page and is open on every link (reads.ts availabilityOf: drafts_open), and since drizzle/0693 a link at
// level 1 also makes a level-2 function directly (reads.ts directLevelOk). This test renders the REAL card from the REAL registry and fails if:
//   - any row of the card's function list carries a level above the person's level (the old table did, for create_project and 66 others);
//   - create_project (or any change the person's role may do) is missing from what the card says may be proposed;
//   - the card stops saying, in plain words, that a proposal is allowed at any level.
import { describe, test, expect } from "bun:test"
import { LIMITS } from "../../../supabase/functions/_shared/ai-link/core"
import { LINK_FUNCTIONS, functionDef } from "../../../supabase/functions/ai-work-link/api-definition"
import { effectiveFunctionViews, type AwlConfig, type LinkCtx } from "../../../supabase/functions/ai-work-link/reads"
import { renderCard } from "../../../supabase/functions/ai-work-link/manual"

const F = "https://example.supabase.co/functions/v1/ai-work-link"
const config: AwlConfig = { functionBase: F, confirmHost: "confirm.example.pages.dev", appBase: "https://app.example", addressPosition: null, execPresent: true }
const enc = new TextEncoder()
const ALL = LINK_FUNCTIONS.map((f) => f.function_id)

function card(level: number, scope: "user" | "project", functionIds: string[] = ALL): { text: string; ctx: LinkCtx } {
  const ctx: LinkCtx = {
    scope, link_id: "lnk_1", org_id: "org_1", user_id: "u_1", user_name: "Sumeet",
    project_id: scope === "user" ? null : "proj_1", project_name: scope === "user" ? null : "ZOOMIES",
    live_role: "manager", live_rank: 3, authority_level: level, allowed_functions: functionIds, effective_level: level,
    effective_functions: functionIds, money_visible: true, hide_personal: false, label: null, expires_at: "2026-10-27T00:00:00Z", writes_enabled: true,
  }
  return { text: renderCard({ ctx, functions: effectiveFunctionViews({ ctx, config }) }), ctx }
}

/** The card's "## Functions" section, up to the next heading. */
function functionsSection(text: string): string {
  const start = text.indexOf("## Functions")
  expect(start).toBeGreaterThan(-1)
  const end = text.indexOf("\n## ", start + 3)
  return text.slice(start, end === -1 ? undefined : end)
}

/**
 * Every level the card attributes to a single function: a table column named Level (any table shape), or "<id> ... level N" on one line.
 * Returns [function id, level] pairs.
 */
function perFunctionLevels(section: string): [string, number][] {
  const out: [string, number][] = []
  const lines = section.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const cells = lines[i].replace(/^\||\|$/g, "").split("|").map((c) => c.trim().toLowerCase())
    const col = cells.indexOf("level")
    if (cells.length > 1 && col !== -1) {
      for (let j = i + 1; j < lines.length && lines[j].includes("|"); j++) {
        const row = lines[j].replace(/^\||\|$/g, "").split("|").map((c) => c.trim())
        const n = Number(row[col])
        if (row[0] && !/^-+$/.test(row[0]) && Number.isFinite(n)) out.push([row[0].replace(/`/g, ""), n])
      }
    }
    const m = /`?([a-z][a-z0-9_]+)`?[^\n]*?\blevel\s*[:=]?\s*(\d)/i.exec(lines[i])
    if (m && functionDef(m[1])) out.push([m[1], Number(m[2])])
  }
  return out
}

describe("the paste card never says a function needs a higher level than the person has (A32/A37)", () => {
  test("the registry really has change functions above level 1 (create_project among them), so this test means something", () => {
    expect(functionDef("create_project")?.link_level).toBeGreaterThan(1)
    expect(LINK_FUNCTIONS.filter((f) => f.kind === "write" && (f.link_level ?? 0) > 1).length).toBeGreaterThan(10)
  })

  for (const scope of ["user", "project"] as const) {
    for (const level of [0, 1]) {
      test(`${scope} link at level ${level}: no function in the card is given a level above ${level}`, () => {
        const { text, ctx } = card(level, scope)
        const levels = perFunctionLevels(functionsSection(text))
        const above = levels.filter(([, n]) => n > ctx.effective_level)
        expect(above, `the card says these need a higher level than the person has: ${above.slice(0, 5).map(([id, n]) => `${id}=${n}`).join(", ")}`).toEqual([])
      })
    }
  }

  test("a level-1 person link: create_project is listed as a change that may be proposed, and the card says a proposal is allowed at any level", () => {
    const { text } = card(1, "user")
    const section = functionsSection(text)
    expect(section).toContain("You may propose every change below, at any level")
    expect(section).toContain("nothing changes until the person confirms it")
    // create_project is a row of the CHANGE table (not only a read id), with its required parameter
    expect(section).toMatch(/^Change \| Required$/m)
    expect(section).toMatch(/^create_project \| name\|shell$/m)
    // and the card's own example block is create_project
    expect(text).toContain('{"v":1,"function":"create_project","params":{"name":"Marina Club"}')
    // every change function on the link is a row of the change table; no read function is
    for (const f of LINK_FUNCTIONS) {
      const row = new RegExp(`^${f.function_id} \\| `, "m").test(section)
      expect(row, f.function_id).toBe(f.kind === "write")
    }
    // it stays inside the card budget with every function of the registry
    expect(enc.encode(text).length).toBeLessThanOrEqual(LIMITS.cardMaxBytes)
  })

  test("a link with no change function says there is nothing to propose (and no level)", () => {
    const reads = LINK_FUNCTIONS.filter((f) => f.kind === "read").map((f) => f.function_id)
    const { text } = card(0, "project", reads)
    const section = functionsSection(text)
    expect(section).toContain("No change function is on this link: nothing to propose.")
    expect(perFunctionLevels(section)).toEqual([])
  })
})
