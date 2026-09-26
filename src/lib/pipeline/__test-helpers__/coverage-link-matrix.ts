// PROJEXA-BUILD-002 WP-05 (coverage waves): the part of the per-function proof that every wave shares, the LINK's own answers for one function
// (register rows AW-301 to AW-308). A wave's test file gives one PolicyRow per function, written out again by hand (an independent copy of the
// policy in scripts/gen-ai-link-registry.data.ts, so a typo there is caught), and registerLinkMatrix() registers, for each row, tests that run the
// REAL Edge handler (supabase/functions/ai-work-link/handler.ts) over the link-database fake (awl-edge-fake.ts):
//
//   registry     the generated row says the level, the minimum rank, the money flag, the kind, the text parameters and the id parameters written here,
//                declares every parameter of the valid set and of the optional set, and requires exactly the names in `required`;
//   rank         a viewer (rank 1), a member (rank 2) and a manager (rank 3) link: the function is on the link's effective list exactly from its minimum
//                rank up, /check and /actions and /functions/{fn} answer 403 FUNCTION_NOT_ON_LINK below it, and a rank-2 function is on a member link;
//   parameters   a complete set is a valid check; each missing required name is reported in `missing`; an undeclared name is reported; each optional
//                name is accepted; text over 2,000 characters is TEXT_TOO_LONG and exactly 2,000 is accepted; a body over 8 KB is 413;
//   level        a level-2 function is refused on /actions with 403 LEVEL_NOT_ALLOWED and is a valid proposal on /propose (nothing changes: a confirm
//                link for the person); every write is accepted as a draft on /drafts (201, a confirm link, nothing changed); a level-1 function is a direct action (will_execute_directly) once the
//                Edge executor is present, and until then /actions answers 503 and /check says it will not run directly; a read is refused on
//                /actions and reaches the executor gate on /functions/{fn}.
//
// WHAT IS NOT HERE: the executor's own checks (which record belongs to which project, the money nulls, the text cleaning at write time). Those are
// function specific and live in each wave file, over the real executor.ts.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { handleAwl } from "../../../../supabase/functions/ai-work-link/handler"
import { LIMITS } from "../../../../supabase/functions/_shared/ai-link/core"
import { TOKENS, makeFake, req, testConfig } from "../../services/__test-helpers__/awl-edge-fake"

export type PolicyRow = {
  id: string
  kind: "read" | "write"
  level: 0 | 1 | 2
  rank: 1 | 2 | 3
  money: boolean
  /** A complete, valid parameter set. No projectId: the link supplies it. */
  valid: Record<string, unknown>
  /** The names the registry requires, without projectId, in the order the registry lists them. */
  required: string[]
  /** Optional declared parameters, one sample value each. */
  optional?: Record<string, unknown>
  /** The free-text parameters (spec 9.11), as the policy lists them. */
  text?: string[]
  /** The id parameters that get the same-project check (spec 9.10). */
  ids?: string[]
}

type Reg = {
  function_id: string
  kind: string
  link_level: number | null
  min_role_rank: number
  money_sensitive: boolean
  excluded_reason: string | null
  text_params: string[]
  id_params: string[]
  declared_params: string[]
  required_params: Array<{ name: string; any_of: string[] }>
  body_max_bytes?: number
}

const REGISTRY = JSON.parse(readFileSync(new URL("../../../../supabase/functions/ai-work-link/function-registry.generated.json", import.meta.url), "utf8")) as Reg[]
const regOf = (id: string) => REGISTRY.find((f) => f.function_id === id)

const TOKEN_OF_RANK: Record<number, string> = { 1: TOKENS.viewer, 2: TOKENS.member, 3: TOKENS.manager }

/** `execPresent` is the Edge executor of a later unit (config.execPresent): off by default, as in production today. */
function link(over: { execPresent?: boolean } = {}) {
  const fake = makeFake({ writesEnabled: true })
  const run = (path: string, init: Parameters<typeof req>[1] = {}) => handleAwl(req(path, init), { rpc: fake.rpc, config: testConfig(over), log: () => {} })
  const check = (token: string, fn: string, params: Record<string, unknown>) => run(`/${token}/check`, { method: "POST", body: { function: fn, params } })
  return { fake, run, check }
}

type CheckBody = { valid: boolean; missing: string[]; problems: string[]; level: number; will_execute_directly: boolean; code?: string; error?: string }
const jsonOf = async <T = CheckBody>(r: Response) => (await r.json()) as T

const without = (o: Record<string, unknown>, key: string) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== key))

/**
 * The functions a link of that rank (1 viewer, 2 member, 3 manager) has on its effective list now, as the REAL handler answers /context. The Edge
 * executor passes this list to executeRead() as `allowedFunctionIds`, so a wave file uses it to prove that a read below its minimum rank is
 * refused end to end (link list, then executor), not only by the link.
 */
export async function effectiveList(rank: 1 | 2 | 3): Promise<string[]> {
  const { run } = link()
  const ctx = await jsonOf<{ allowed_functions: string[] }>(await run(`/${TOKEN_OF_RANK[rank]}/context`, { headers: { accept: "application/json" } }))
  return ctx.allowed_functions
}

/** Registers the link tests of every row of one wave. `wave` is the label of the describe block, for example "AW-301 wave 1". */
export function registerLinkMatrix(wave: string, rows: readonly PolicyRow[]): void {
  describe(`${wave}: the link's own answers, through the real Edge handler`, () => {
    for (const row of rows) {
      describe(row.id, () => {
        const reg = regOf(row.id)

        test("registry: the generated row has this level, rank, money flag, kind, text and id parameters, and declares every parameter used here", () => {
          expect(reg).toBeDefined()
          expect({
            kind: reg!.kind, level: reg!.link_level, rank: reg!.min_role_rank, money: reg!.money_sensitive, reason: reg!.excluded_reason,
            text: [...reg!.text_params].sort(), ids: [...reg!.id_params].sort(), required: reg!.required_params.map((r) => r.name).filter((n) => n !== "projectId"),
          }).toEqual({
            kind: row.kind, level: row.level, rank: row.rank, money: row.money, reason: null,
            text: [...(row.text ?? [])].sort(), ids: [...(row.ids ?? [])].sort(), required: row.required,
          })
          for (const name of [...Object.keys(row.valid), ...Object.keys(row.optional ?? {}), ...(row.text ?? []), ...(row.ids ?? [])]) {
            expect({ id: row.id, name, declared: reg!.declared_params.includes(name) }).toEqual({ id: row.id, name, declared: true })
          }
          // 8 KB unless the policy gives the function more; these waves give no function more
          expect(reg!.body_max_bytes).toBeUndefined()
        })

        test("rank: on the effective list of a link exactly from its minimum rank up; below it every route answers 403 FUNCTION_NOT_ON_LINK", async () => {
          const { run, check } = link()
          for (const rank of [1, 2, 3]) {
            const token = TOKEN_OF_RANK[rank]
            const ctx = await jsonOf<{ allowed_functions: string[] }>(await run(`/${token}/context`, { headers: { accept: "application/json" } }))
            const on = rank >= row.rank
            expect({ id: row.id, rank, on: ctx.allowed_functions.includes(row.id) }).toEqual({ id: row.id, rank, on })
            const res = await check(token, row.id, row.valid)
            if (on) {
              expect({ rank, status: res.status }).toEqual({ rank, status: 200 })
            } else {
              expect({ rank, status: res.status, code: (await jsonOf(res)).code }).toEqual({ rank, status: 403, code: "FUNCTION_NOT_ON_LINK" })
              const route = row.kind === "read" ? `/${token}/functions/${row.id}` : `/${token}/actions`
              const other = await run(route, { method: "POST", body: row.kind === "read" ? { params: row.valid } : { function: row.id, params: row.valid } })
              expect({ rank, route: route.replace(token, "T"), status: other.status, code: (await jsonOf(other)).code }).toEqual({ rank, route: route.replace(token, "T"), status: 403, code: "FUNCTION_NOT_ON_LINK" })
              const asDraft = await run(`/${token}/drafts`, { method: "POST", body: { function: row.id, params: row.valid } })
              if (row.kind === "write") expect({ rank, status: asDraft.status }).toEqual({ rank, status: 403 })
            }
          }
        })

        test("parameters: a complete set is valid; each missing required name is reported; an undeclared name is reported; every optional name is accepted", async () => {
          const { check } = link()
          const token = TOKENS.manager
          const good = await jsonOf(await check(token, row.id, row.valid))
          expect(good).toMatchObject({ valid: true, missing: [], problems: [], level: row.level })
          for (const name of row.required) {
            const res = await jsonOf(await check(token, row.id, without(row.valid, name)))
            expect({ id: row.id, name, valid: res.valid, missing: res.missing }).toEqual({ id: row.id, name, valid: false, missing: [name] })
          }
          const stray = await jsonOf(await check(token, row.id, { ...row.valid, not_a_param: 1 }))
          expect(stray.valid).toBe(false)
          expect(stray.problems.join(" ")).toContain("Unknown parameter not_a_param")
          for (const [name, value] of Object.entries(row.optional ?? {})) {
            const res = await jsonOf(await check(token, row.id, { ...row.valid, [name]: value }))
            expect({ id: row.id, name, valid: res.valid, problems: res.problems }).toEqual({ id: row.id, name, valid: true, problems: [] })
          }
        })

        test("size and text: a body over 8 KB is 413; a text parameter over 2,000 characters is TEXT_TOO_LONG and exactly 2,000 is accepted", async () => {
          const { run, check } = link()
          const token = TOKENS.manager
          const big = await run(`/${token}/check`, { method: "POST", body: { function: row.id, params: { ...row.valid, pad: "x".repeat(9000) } } })
          expect({ id: row.id, status: big.status }).toEqual({ id: row.id, status: 413 })
          for (const name of row.text ?? []) {
            const over = await jsonOf(await check(token, row.id, { ...row.valid, [name]: "x".repeat(LIMITS.textMax + 1) }))
            expect({ id: row.id, name, valid: over.valid, tooLong: over.problems.some((p) => p.includes("TEXT_TOO_LONG") && p.includes(name)) }).toEqual({ id: row.id, name, valid: false, tooLong: true })
            const exact = await jsonOf(await check(token, row.id, { ...row.valid, [name]: "x".repeat(LIMITS.textMax) }))
            expect({ id: row.id, name, valid: exact.valid, problems: exact.problems }).toEqual({ id: row.id, name, valid: true, problems: [] })
          }
        })

        test("level: " + (row.level === 2 ? "a draft only: refused on /actions, a valid proposal on /propose" : row.level === 1 ? "a direct action: will_execute_directly, and /actions reaches the executor gate" : "a read: refused on /actions, reaches the executor gate on /functions/{fn}"), async () => {
          const { run, check } = link()
          const token = TOKEN_OF_RANK[row.rank]
          const res = await jsonOf(await check(token, row.id, row.valid))
          expect(res.level).toBe(row.level)
          // no Edge executor yet (production today): nothing runs directly, whatever the level
          expect(res.will_execute_directly).toBe(false)
          // with the executor present a level-1 function runs directly and no other level does
          const withExec = link({ execPresent: true })
          const direct = await jsonOf(await withExec.check(token, row.id, row.valid))
          expect({ id: row.id, level: direct.level, direct: direct.will_execute_directly }).toEqual({ id: row.id, level: row.level, direct: row.level === 1 })
          const actions = await run(`/${token}/actions`, { method: "POST", body: { function: row.id, params: row.valid } })
          if (row.level === 2) {
            expect({ status: actions.status, code: (await jsonOf(actions)).code }).toEqual({ status: 403, code: "LEVEL_NOT_ALLOWED" })
            const query = new URLSearchParams({ fn: row.id, ...Object.fromEntries(Object.entries(row.valid).map(([k, v]) => [`p.${k}`, String(v)])) })
            const proposed = await run(`/${token}/propose?${query.toString()}`, { headers: { accept: "application/json" } })
            expect(proposed.status).toBe(200)
            const body = await jsonOf<{ check: CheckBody; confirm_url: string; note: string }>(proposed)
            expect(body.check).toMatchObject({ valid: true, level: 2, will_execute_directly: false })
            expect(body.note).toContain("Nothing has changed")
            expect(typeof body.confirm_url).toBe("string")
          } else if (row.level === 1) {
            expect({ id: row.id, status: actions.status }).toEqual({ id: row.id, status: 503 })
          } else {
            expect({ id: row.id, status: actions.status }).toEqual({ id: row.id, status: 400 })
            const read = await run(`/${token}/functions/${row.id}`, { method: "POST", body: { params: row.valid } })
            expect({ id: row.id, status: read.status }).toEqual({ id: row.id, status: 503 })
          }
        })

        if (row.kind === "write") {
          test("draft: a write is accepted as a draft (201, a confirm link for the person, nothing changed); an incomplete draft is 422 and names what is missing", async () => {
            const { run } = link()
            const token = TOKEN_OF_RANK[row.rank]
            const made = await run(`/${token}/drafts`, { method: "POST", body: { function: row.id, params: row.valid, idempotency_key: `draft-${row.id}` } })
            expect({ id: row.id, status: made.status }).toEqual({ id: row.id, status: 201 })
            const body = await jsonOf<{ draft_id: string; confirm_url: string; note: string; function: string; kind: string }>(made)
            expect(body).toMatchObject({ function: row.id, kind: "draft" })
            expect(typeof body.draft_id).toBe("string")
            expect(body.confirm_url).toContain("/ai-confirm.html#d=")
            expect(body.note).toContain("Nothing has changed")
            for (const name of row.required.slice(0, 1)) {
              const bad = await run(`/${token}/drafts`, { method: "POST", body: { function: row.id, params: without(row.valid, name), idempotency_key: `draft-bad-${row.id}` } })
              expect({ id: row.id, name, status: bad.status }).toEqual({ id: row.id, name, status: 422 })
              expect(await jsonOf<{ missing: string[] }>(bad)).toMatchObject({ missing: [name] })
            }
          })
        }
      })
    }
  })
}
