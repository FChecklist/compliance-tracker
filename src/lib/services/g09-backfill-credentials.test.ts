// G-09: scripts/g09-backfill-credentials.mjs against two fake PostgREST servers: counts only (never a key or id in the output), dry run writes nothing,
// --apply calls the put function once per well-formed row and reports the SQL's own outcomes, a re-run is safe.
import { describe, expect, test } from "bun:test"
import { join } from "node:path"

const SCRIPT = join(import.meta.dir, "..", "..", "..", "scripts", "g09-backfill-credentials.mjs")
const SECRET = "vk_SECRETSECRETSECRETSECRETSECRET00"
const ORG1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const ORG2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"

function servers(rows: unknown[], outcomes: string[]) {
  const puts: unknown[] = []
  const legacy = Bun.serve({ port: 0, fetch: () => Response.json(rows) })
  const veridian = Bun.serve({
    port: 0,
    async fetch(req) {
      puts.push(await req.json())
      return Response.json(outcomes.shift() ?? "stored")
    },
  })
  return { legacy, veridian, puts, stop: () => (legacy.stop(true), veridian.stop(true)) }
}
async function run(s: ReturnType<typeof servers>, args: string[]) {
  const p = Bun.spawn(["node", SCRIPT, ...args], {
    env: { ...process.env, PROJEXA_SUPABASE_URL: `http://localhost:${s.legacy.port}`, PROJEXA_SERVICE_ROLE_KEY: "srk1", VERIDIAN_SUPABASE_URL: `http://localhost:${s.veridian.port}`, VERIDIAN_SERVICE_ROLE_KEY: "srk2" },
    stdout: "pipe",
    stderr: "pipe",
  })
  const out = await new Response(p.stdout).text()
  const err = await new Response(p.stderr).text()
  return { out, err, code: await p.exited }
}
const ROWS = [
  { organization_id: ORG1, veridian_org_id: "v1", veridian_api_key: SECRET },
  { organization_id: ORG2, veridian_org_id: "v2", veridian_api_key: SECRET + "2" },
  { organization_id: "not-a-uuid", veridian_org_id: "v3", veridian_api_key: "k" },
  { organization_id: ORG1, veridian_org_id: "", veridian_api_key: "k" },
]

describe("g09-backfill-credentials.mjs", () => {
  test("dry run: counts only, nothing written, no secret printed", async () => {
    const s = servers(ROWS, [])
    const r = await run(s, [])
    s.stop()
    expect(r.code).toBe(0)
    expect(JSON.parse(r.out)).toEqual({ mode: "dry-run", legacy_rows: 4, well_formed: 2, malformed: 2 })
    expect(s.puts).toHaveLength(0)
    expect(r.out + r.err).not.toContain(SECRET)
    expect(r.out + r.err).not.toContain(ORG1)
  })

  test("--apply: one put per well-formed row, the SQL's outcomes are the report, nothing secret printed", async () => {
    const s = servers(ROWS, ["stored", "key_mismatch"])
    const r = await run(s, ["--apply"])
    s.stop()
    expect(r.code).toBe(0)
    expect(JSON.parse(r.out)).toEqual({ mode: "apply", legacy_rows: 4, well_formed: 2, malformed: 2, outcomes: { stored: 1, key_mismatch: 1 } })
    expect(s.puts).toEqual([
      { p_projexa_org_id: ORG1, p_veridian_org_id: "v1", p_api_key: SECRET },
      { p_projexa_org_id: ORG2, p_veridian_org_id: "v2", p_api_key: SECRET + "2" },
    ])
    expect(r.out + r.err).not.toContain(SECRET)
  })

  test("a missing environment variable is refused before anything is read", async () => {
    const p = Bun.spawn(["node", SCRIPT], { env: { PATH: process.env.PATH ?? "" }, stdout: "pipe", stderr: "pipe" })
    expect(await p.exited).toBe(2)
  })
})
