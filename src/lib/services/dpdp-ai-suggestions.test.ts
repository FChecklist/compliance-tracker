// The AI work link's shared suggestion pool (drizzle/0671): the safety shape.
// An outside AI may ADD an idea or ADD ITS VOICE to one, and READ the pool --
// nothing else, and never anything that touches the product's code or any
// customer's data. Pure/static checks; the live behaviour is exercised against
// the database in the PR's verification.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { ENDPOINTS } from "../../../supabase/functions/dpdp-ai-link/api-definition"
import { methodsFor, parseRoute } from "../../../supabase/functions/dpdp-ai-link/router"

const T = "a".repeat(32)
const SQL = readFileSync(join(__dirname, "../../../drizzle/0671_dpdp_ai_suggestions.sql"), "utf8")
const MANUAL = readFileSync(join(__dirname, "../../../supabase/functions/dpdp-ai-link/manual.ts"), "utf8")

describe("routes", () => {
  test("/suggestions takes GET (read the pool) and POST (add or endorse), nothing else", () => {
    const p = parseRoute(`/ai/${T}/suggestions`)
    if (!("route" in p)) throw new Error("unparsed")
    expect(p.route.kind).toBe("suggestions")
    expect(methodsFor(p.route)).toEqual(["GET", "POST"])
  })
  test("the ONLY write paths an AI link has: actions (own view), drafts (confirmed by the person), suggestions (the shared pool)", () => {
    const writes = ENDPOINTS.filter((e) => e.method === "POST").map((e) => e.path).sort()
    expect(writes).toEqual(["/actions", "/drafts", "/suggestions"])
  })
  test("suggestions are open at every level but carry no job id: the endpoint cannot be pointed at a customer row", () => {
    const post = ENDPOINTS.find((e) => e.id === "suggest")!
    expect(post.level).toBe(0)
    expect(post.body ?? "").not.toMatch(/job_id/)
  })
})

describe("the migration", () => {
  test("both tables are RLS-on with no grants to public, anon or authenticated", () => {
    expect(SQL).toMatch(/alter table dpdp\.ai_suggestion enable row level security/)
    expect(SQL).toMatch(/alter table dpdp\.ai_suggestion_vote enable row level security/)
    expect(SQL).toMatch(/revoke all on dpdp\.ai_suggestion, dpdp\.ai_suggestion_vote from public, anon, authenticated/)
  })
  test("only service_role may set a status; the link functions are not granted to anyone else", () => {
    expect(SQL).toMatch(/grant execute on function public\.dpdp_suggestion_set_status\(text, text, text\) to service_role;/)
    expect(SQL).not.toMatch(/grant [^;]*\) to [^;]*(anon|authenticated|public)[^;]*;/)
  })
  test("votes are append-only", () => {
    expect(SQL).toMatch(/ai_suggestion_vote is append-only/)
  })
  test("the shared list never returns the sender, the link or the internal note", () => {
    const list = SQL.slice(SQL.indexOf("function public.dpdp_ai_link_suggestions"), SQL.indexOf("function public.dpdp_suggestion_set_status"))
    expect(list).not.toMatch(/first_link_id|internal_note|org_id|membership/)
  })
  test("it refuses personal data and the customer's own name, and caps new ideas per link per day", () => {
    for (const w of ["an email address", "a phone number", "a PAN or Aadhaar number", "a link address that carries a private token", "the name of the organisation"]) expect(SQL).toContain(w)
    expect(SQL).toMatch(/v_made_today >= 20/)
  })
  test("it touches no job, person or organisation row", () => {
    const body = SQL.slice(SQL.indexOf("function public.dpdp_ai_link_suggest("))
    expect(body).not.toMatch(/(update|delete from|insert into) dpdp\.(obligation|membership|organisation|identity|ai_action|ai_draft)/)
  })
})

describe("the manual", () => {
  test("tells the AI it can suggest, and that it cannot change the software or other people's data", () => {
    expect(MANUAL).toMatch(/POST \/suggestions/)
    expect(MANUAL).toMatch(/Change the VERIDIAN software, its settings, or its code/)
    expect(MANUAL).toMatch(/another organisation's data/)
  })
})
