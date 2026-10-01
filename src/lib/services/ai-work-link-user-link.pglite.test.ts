/// <reference types="bun-types" />
// PROJEXA USER-WIDE AI WORK LINK: drizzle/0668_awl_user_wide_link.sql and 0669_awl_seed_user_link_create_project.sql on PGlite (real Postgres as WASM), applied
// on top of 0621 to 0651 the way the live database has them. It holds what the route tests cannot see, the SQL rules:
//   * the table: a user link has no project and level 0, whatever a caller tries to insert; one live user link per person; a project link is unchanged
//   * minting: level 0 for ever, every function the person's rank may have, the previous user link revoked, the same caps, an inactive person refused
//   * tenant isolation and readability: the list holds ONLY the projects the person may read in the link's organisation (never another organisation's,
//     never a private project of someone else); a foreign, a private-unreadable and a missing project answer EXACTLY alike (no existence oracle)
//   * money: the project value in the list is null where the role may not see cost
//   * the effective functions: a user link outside a project holds create_project and nothing else; inside one every function but create_project; a PROJECT
//     link never holds create_project, even when its allowed_functions names it
//   * drafts: create_project needs no project and only a user link may record it; every other function needs a project; a retry key is per project;
//     5 new projects a person a day; the claim binds the project again, so a project that turned unreadable refuses the intent
//   * the down files: 0668 refuses while a user link exists, and otherwise restores the old functions
// Run: bun test --isolate src/lib/services/ai-work-link-user-link.pglite.test.ts
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import type { PGlite } from "@electric-sql/pglite"
import { downSql, forwardSql, one } from "./__test-helpers__/awl-pglite"
import { USER_LINK_MIGRATIONS, call, createUserLinkDb, mintProject, mintUser, refused, setWrites, type J } from "./__test-helpers__/awl-user-link-db"

setDefaultTimeout(120_000)

const NEW_FUNCTIONS = ["ai_work_link__bind", "ai_work_link__fns", "ai_work_link__require_in", "ai_work_link__resolve_in", "ai_work_link_mint_user_for", "ai_work_link_projects"]

let db: PGlite

const records = (token: string, kind: string, project: string | null, limit = 50) => call(db, "ai_work_link_records", [token, kind, null, limit, "{}", project])
const resolveIn = (token: string, project: string) => call(db, "ai_work_link__resolve_in", [token, project])
const intent = (token: string, kind: "draft" | "action", fn: string, params: object, key: string | null, project: string | null) =>
  call(db, "ai_work_link_record_intent", [token, kind, fn, params, key, project])
const refusedIntent = (token: string, kind: string, fn: string, params: object, key: string | null, project: string | null) =>
  refused(db, "select public.ai_work_link_record_intent($1, $2, $3, $4::jsonb, $5, $6)", [token, kind, fn, JSON.stringify(params), key, project])

beforeAll(async () => {
  db = await createUserLinkDb()
  // proof rows for the list: tasks, one overdue, one done, and a BOQ line, in proj-a; and a task in organisation B's project
  await db.exec(`
    insert into compliance.pms_issues (id, org_id, project_id, type_id, status_id, number, title, due_date, completion_percentage) values
      ('t1', 'org-a', 'proj-a', 'ty', 'st', 1, 'Pour slab',  current_date - 5, 10),
      ('t2', 'org-a', 'proj-a', 'ty', 'st', 2, 'Paint wall', current_date + 5, 0),
      ('t3', 'org-a', 'proj-a', 'ty', 'st', 3, 'Done',       current_date - 9, 100),
      ('t4', 'org-b', 'proj-b', 'ty', 'st', 1, 'B task',     null, 0);
    insert into compliance.construction_boqs (id, org_id, project_id, title, created_by_id) values ('boq1', 'org-a', 'proj-a', 'BOQ 1', 'u-mgr');
    insert into compliance.construction_boq_line_items (id, boq_id, description, unit, org_id) values ('li1', 'boq1', 'Slab', 'cum', 'org-a'), ('li2', 'boq1', 'Wall', 'sqm', 'org-a');
  `)
}, 240_000)
afterAll(async () => {
  await db.close()
})

describe("the table", () => {
  test("a user link has no project and level 0, whatever is inserted: the CHECKs refuse a project, level 1 and a plain token", async () => {
    const base = (over: string) =>
      `insert into platform.user_ai_links (id, org_id, user_id, token, status, product, project_id, token_hash, authority_level, allowed_functions, expires_at, scope) values ${over}`
    const exp = "now() + interval '1 day'"
    expect((await refused(db, base(`('x1', 'org-a', 'u-mem', null, 'active', 'projexa', 'proj-a', 'h1', 0, '{}', ${exp}, 'user')`)))?.message).toContain("user_ai_links_user_scope_shape")
    expect((await refused(db, base(`('x2', 'org-a', 'u-mem', null, 'active', 'projexa', null, 'h2', 1, '{}', ${exp}, 'user')`)))?.message).toContain("user_ai_links_user_scope_shape")
    expect((await refused(db, base(`('x3', 'org-a', 'u-mem', 'plain', 'active', 'projexa', null, 'h3', 0, '{}', ${exp}, 'user')`)))?.message).toContain("user_ai_links_projexa_shape")
    expect((await refused(db, base(`('x4', 'org-a', 'u-mem', null, 'active', 'projexa', null, 'h4', 0, '{}', ${exp}, 'project')`)))?.message).toContain("user_ai_links_projexa_shape")
    expect((await refused(db, base(`('x5', 'org-a', 'u-mem', null, 'active', 'projexa', 'proj-a', 'h5', 0, '{}', ${exp}, 'galaxy')`)))?.message).toContain("user_ai_links_scope_check")
    expect((await one<{ n: number }>(db, "select count(*)::int n from platform.user_ai_links where id like 'x%'")).n).toBe(0)
  })

  test("a project link is exactly what it was: scope 'project', a project, its own level; the veridian shape is untouched", async () => {
    const m = await mintProject(db, "u-mem", "proj-a", { level: 1 })
    const row = await one<J>(db, "select scope, project_id, authority_level from platform.user_ai_links where id = $1", [m.link_id])
    expect(row).toMatchObject({ scope: "project", project_id: "proj-a", authority_level: 1 })
    await db.exec(`insert into platform.user_ai_links (id, org_id, user_id, token, status, product) values ('v1', 'org-a', 'u-mem', 'tok', 'active', 'veridian')`)
    expect((await one<J>(db, "select scope, project_id from platform.user_ai_links where id = 'v1'"))).toMatchObject({ scope: "project", project_id: null })
    await db.exec("delete from platform.user_ai_links where id = 'v1'")
  })
})

describe("minting", () => {
  test("level 0, no project, only the hash stored, every function the person's rank may have, and the answer says scope user", async () => {
    const m = await mintUser(db, "u-mgr", { days: 30, label: "  My AI  " })
    expect(m).toMatchObject({ scope: "user", level: 0, project: null, label: "My AI", user_id: "u-mgr" })
    expect(m.token).toMatch(/^pxa_[0-9a-f]{64}$/)
    const row = await one<J>(db, "select token, token_hash, project_id, authority_level, scope, org_id, created_by_user_id, status from platform.user_ai_links where id = $1", [m.link_id])
    expect(row).toMatchObject({ token: null, project_id: null, authority_level: 0, scope: "user", org_id: "org-a", created_by_user_id: "u-mgr", status: "active" })
    expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(row)).not.toContain(m.token)
    expect(m.allowed_functions).toContain("create_project")
    expect(m.allowed_functions).toContain("record_work_progress")
    // a viewer (rank 1) holds only the rank 1 functions, and no create_project (rank 2)
    const v = await mintUser(db, "u-view")
    expect(v.allowed_functions).not.toContain("create_project")
    expect(v.allowed_functions).toContain("get_construction_project_dashboard")
  })

  test("the default label, and the refusals: an inactive person (USER_NOT_ACTIVE), days other than 1, 7, 30 (BAD_DAYS), a person who does not exist", async () => {
    expect((await mintUser(db, "u-adm")).label).toBe("All my projects")
    expect((await refused(db, "select public.ai_work_link_mint_user_for('u-off', 7, null)"))?.message).toBe("USER_NOT_ACTIVE")
    expect((await refused(db, "select public.ai_work_link_mint_user_for('nobody', 7, null)"))?.message).toBe("USER_NOT_ACTIVE")
    expect((await refused(db, "select public.ai_work_link_mint_user_for('u-adm', 3, null)"))?.message).toBe("BAD_DAYS")
  })

  test("one live user link per person: the next mint revokes the previous one, which then answers gone; another person's link is untouched", async () => {
    const a = await mintUser(db, "u-sen")
    const other = await mintUser(db, "u-view")
    const b = await mintUser(db, "u-sen")
    expect((await call(db, "ai_work_link__resolve", [a.token])).status).toBe("gone")
    expect((await call(db, "ai_work_link__resolve", [b.token])).status).toBe("ok")
    expect((await call(db, "ai_work_link__resolve", [other.token])).status).toBe("ok")
    expect((await one<{ n: number }>(db, "select count(*)::int n from platform.user_ai_links where user_id = 'u-sen' and scope = 'user' and status = 'active'")).n).toBe(1)
    // the index itself refuses a second live user link, whoever writes it
    const e = await refused(
      db,
      `insert into platform.user_ai_links (id, org_id, user_id, token, status, product, project_id, token_hash, authority_level, allowed_functions, expires_at, scope)
       values ('dup', 'org-a', 'u-sen', null, 'active', 'projexa', null, 'hdup', 0, '{}', now() + interval '1 day', 'user')`,
    )
    expect(e?.message).toContain("user_ai_links_one_live_user_scope")
  })

  test("the caps are the project mint's: 10 links an hour for the person, a user link and a project link counted together", async () => {
    await db.exec("insert into compliance.users (id, name, email, password_hash, role, is_active, org_id) values ('u-cap', 'Cap Person', 'cap@a.example.test', 'x', 'member', true, 'org-a')")
    for (let i = 0; i < 5; i++) await mintUser(db, "u-cap", { age: false })
    for (let i = 0; i < 5; i++) await mintProject(db, "u-cap", "proj-a", { age: false })
    expect((await refused(db, "select public.ai_work_link_mint_user_for('u-cap', 7, null)"))?.message).toBe("MINT_CAP_HOUR")
    expect((await refused(db, "select public.ai_work_link_mint_for('u-cap', 'proj-a', 0, null, 7, true, null)"))?.message).toBe("MINT_CAP_HOUR")
  })

  test("the person's own list tells the two kinds apart and shows a user link with no project", async () => {
    const m = await mintUser(db, "u-adm")
    const list = await call<J[]>(db, "ai_work_link_list_for", ["u-adm", null])
    const mine = list.find((l) => l.id === m.link_id)!
    expect(mine).toMatchObject({ scope: "user", project_id: null, project_name: null, level: 0, active: true })
    expect(JSON.stringify(list)).not.toContain(m.token)
    expect(JSON.stringify(list)).not.toContain("token_hash")
  })
})

describe("resolve and the effective functions", () => {
  test("a user link resolves with no project, scope user, level 0 and create_project as its only function (rank 2 and above)", async () => {
    const m = await mintUser(db, "u-mem")
    const r = await call(db, "ai_work_link__resolve", [m.token])
    expect(r).toMatchObject({ status: "ok", scope: "user", project_id: null, project_name: null, live_rank: 2, effective_level: 0, effective_functions: ["create_project"], authority_level: 0 })
    // the live view of the same link by id is equal (the parity rule of resolve and live)
    const live = await call(db, "ai_work_link__live", [m.link_id])
    expect(live).toEqual(r)
  })

  test("a viewer has no function outside a project: create_project is rank 2", async () => {
    const m = await mintUser(db, "u-view")
    expect((await call(db, "ai_work_link__resolve", [m.token])).effective_functions).toEqual([])
  })

  test("inside a project: every function of the person's rank but create_project, and the project's name", async () => {
    const m = await mintUser(db, "u-mgr")
    const r = await resolveIn(m.token, "proj-a")
    expect(r).toMatchObject({ status: "ok", scope: "user", project_id: "proj-a", project_name: "Villa A", live_role: "manager", effective_level: 0 })
    expect(r.effective_functions).toContain("record_work_progress")
    expect(r.effective_functions).toContain("get_construction_budget_status")
    expect(r.effective_functions).not.toContain("create_project")
  })

  test("a PROJECT link never holds create_project, even when its allowed_functions names it", async () => {
    const m = await mintProject(db, "u-mgr", "proj-a", { level: 0, fns: ["record_work_progress", "create_project"] })
    expect(m.allowed_functions).toContain("create_project")
    const r = await call(db, "ai_work_link__resolve", [m.token])
    expect(r).toMatchObject({ scope: "project", project_id: "proj-a" })
    expect(r.effective_functions).toEqual(["record_work_progress"])
    // and the minted default (every function of the rank) leaves it out of the effective list too
    const all = await mintProject(db, "u-mgr", "proj-a2", { level: 0 })
    expect((await call(db, "ai_work_link__resolve", [all.token])).effective_functions).not.toContain("create_project")
    expect((await refusedIntent(m.token, "draft", "create_project", { name: "X" }, null, null))?.message).toBe("FUNCTION_NOT_ON_LINK")
  })

  test("a dead user link is gone: revoked, expired, its person deactivated", async () => {
    const m = await mintUser(db, "u-mem")
    await db.exec(`update platform.user_ai_links set expires_at = now() - interval '1 second' where id = '${m.link_id}'`)
    expect((await call(db, "ai_work_link__resolve", [m.token])).status).toBe("gone")
    const n = await mintUser(db, "u-mem")
    await db.exec("update compliance.users set is_active = false where id = 'u-mem'")
    expect((await call(db, "ai_work_link__resolve", [n.token])).status).toBe("gone")
    await db.exec("update compliance.users set is_active = true where id = 'u-mem'")
    expect((await call(db, "ai_work_link__resolve", [n.token])).status).toBe("ok")
  })
})

describe("the list of projects (tenant isolation, readability, money)", () => {
  const ids = (r: J) => (r.projects as J[]).map((p) => p.id)

  test("a manager of organisation A sees the public projects of A and no project of B; the private one of another lead stays hidden", async () => {
    const m = await mintUser(db, "u-mgr")
    const r = await call(db, "ai_work_link_projects", [m.token, 100])
    expect(ids(r).sort()).toEqual(["proj-a", "proj-a2"])
    expect(r).toMatchObject({ total: 2, shown: 2, truncated: false })
    expect(JSON.stringify(r)).not.toContain("Tower B")
    expect(JSON.stringify(r)).not.toContain("Secret")
  })

  test("the lead of a private project and an admin see it; a member does not", async () => {
    const sen = await mintUser(db, "u-sen")
    expect(ids(await call(db, "ai_work_link_projects", [sen.token, 100])).sort()).toEqual(["proj-a", "proj-a2", "proj-priv"])
    const adm = await mintUser(db, "u-adm")
    expect(ids(await call(db, "ai_work_link_projects", [adm.token, 100])).sort()).toEqual(["proj-a", "proj-a2", "proj-priv"])
    const mem = await mintUser(db, "u-mem")
    expect(ids(await call(db, "ai_work_link_projects", [mem.token, 100])).sort()).toEqual(["proj-a", "proj-a2"])
  })

  test("person B of organisation 2 sees only its own projects (its private one too: it is the lead), never organisation A's", async () => {
    const b = await mintUser(db, "u-b")
    const r = await call(db, "ai_work_link_projects", [b.token, 100])
    expect(ids(r).sort()).toEqual(["proj-b", "proj-b-priv"])
    expect(JSON.stringify(r)).not.toContain("Villa")
    expect(JSON.stringify(r)).not.toContain("Secret A")
  })

  test("the rollup: tasks, open and overdue tasks and BOQ lines, counted in the link's organisation only; money nulled where the role may not see cost", async () => {
    const mgr = await mintUser(db, "u-mgr")
    const r = await call(db, "ai_work_link_projects", [mgr.token, 100])
    const a = (r.projects as J[]).find((p) => p.id === "proj-a")!
    expect(a).toMatchObject({ name: "Villa A", status: "active", tasks_total: 3, tasks_open: 2, tasks_overdue: 1, boq_lines: 2, lead: true, project_value: 2500000 })
    expect(r.money_hidden).toBe(false)
    // a member (rank 2) and a senior without cost visibility: the value is null for every project
    for (const who of ["u-mem", "u-sen"]) {
      const m = await mintUser(db, who)
      const x = await call(db, "ai_work_link_projects", [m.token, 100])
      expect(x.money_hidden).toBe(true)
      for (const p of x.projects as J[]) expect({ who, id: p.id, value: p.project_value }).toEqual({ who, id: p.id, value: null })
    }
  })

  test("the list is capped: a limit of 1 shows one project and says truncated, with the real total", async () => {
    const m = await mintUser(db, "u-mgr")
    const r = await call(db, "ai_work_link_projects", [m.token, 1])
    expect(r).toMatchObject({ total: 2, shown: 1, truncated: true })
    expect((await call(db, "ai_work_link_projects", [m.token, 0])).shown).toBe(1)
    expect((await call(db, "ai_work_link_projects", [m.token, 100000])).shown).toBe(2)
  })

  test("a project link may not list projects (USER_LINK_REQUIRED), and a dead link is the one 410 sentence", async () => {
    const p = await mintProject(db, "u-mgr", "proj-a")
    const e = await refused(db, "select public.ai_work_link_projects($1, 100)", [p.token])
    expect(e).toMatchObject({ code: "AW403", message: "USER_LINK_REQUIRED" })
    const gone = await refused(db, "select public.ai_work_link_projects($1, 100)", ["pxa_" + "0".repeat(64)])
    expect(gone).toMatchObject({ code: "AW410" })
  })
})

describe("no existence oracle: a foreign, an unreadable and a missing project answer exactly alike", () => {
  test("records, record, context, resolve_in and record_intent: AW404 PROJECT_NOT_FOUND for proj-b (another organisation), proj-priv (private, not its lead) and a missing id", async () => {
    const mem = await mintUser(db, "u-mem")
    type Ask = (id: string) => Promise<{ code: string; message: string } | null>
    const asks: Array<[string, Ask]> = [
      ["records", (id) => refused(db, "select public.ai_work_link_records($1, 'tasks', null, 50, '{}'::jsonb, $2)", [mem.token, id])],
      ["record", (id) => refused(db, "select public.ai_work_link_record($1, 'tasks', 't1', $2)", [mem.token, id])],
      ["context", (id) => refused(db, "select public.ai_work_link_context($1, $2)", [mem.token, id])],
      ["resolve_in", (id) => refused(db, "select public.ai_work_link__resolve_in($1, $2)", [mem.token, id])],
      ["record_intent", (id) => refused(db, "select public.ai_work_link_record_intent($1, 'draft', 'record_work_progress', '{}'::jsonb, null, $2)", [mem.token, id])],
    ]
    for (const [name, ask] of asks) {
      const answers = await Promise.all(["proj-b", "proj-b-priv", "proj-priv", "no-such-project", ""].map((id) => ask(id)))
      const [first, ...rest] = answers
      expect({ name, first }).toMatchObject({ first: { code: "AW404", message: "PROJECT_NOT_FOUND" } })
      for (const a of rest) expect({ name, a }).toEqual({ name, a: first })
    }
  })

  test("the same ids bind for the people who may read them: the lead and an admin bind proj-priv, a member does not", async () => {
    expect((await resolveIn((await mintUser(db, "u-sen")).token, "proj-priv")).project_name).toBe("Secret A")
    expect((await resolveIn((await mintUser(db, "u-adm")).token, "proj-priv")).project_name).toBe("Secret A")
    expect((await refused(db, "select public.ai_work_link__resolve_in($1, 'proj-priv')", [(await mintUser(db, "u-mem")).token]))?.message).toBe("PROJECT_NOT_FOUND")
  })

  test("a project link asked for another project answers the same 404, and for its own project answers as before", async () => {
    const p = await mintProject(db, "u-mgr", "proj-a")
    expect((await refused(db, "select public.ai_work_link_records($1, 'tasks', null, 50, '{}'::jsonb, 'proj-a2')", [p.token]))).toMatchObject({ code: "AW404", message: "PROJECT_NOT_FOUND" })
    expect((await refused(db, "select public.ai_work_link_records($1, 'tasks', null, 50, '{}'::jsonb, 'proj-b')", [p.token]))).toMatchObject({ code: "AW404", message: "PROJECT_NOT_FOUND" })
    const own = await call(db, "ai_work_link_records", [p.token, "tasks", null, 50, "{}", "proj-a"])
    const plain = await call(db, "ai_work_link_records", [p.token, "tasks", null, 50, "{}", null])
    expect(own).toEqual(plain)
    expect((own.items as J[]).map((i) => i.id).sort()).toEqual(["t1", "t2", "t3"])
  })

  test("a user link with no project cannot read records: PROJECT_REQUIRED (400), never another project's rows", async () => {
    const m = await mintUser(db, "u-mgr")
    expect(await refused(db, "select public.ai_work_link_records($1, 'tasks', null, 50, '{}'::jsonb, null)", [m.token])).toMatchObject({ code: "AW400", message: "PROJECT_REQUIRED" })
    expect(await refused(db, "select public.ai_work_link_record($1, 'tasks', 't1')", [m.token])).toMatchObject({ code: "AW400", message: "PROJECT_REQUIRED" })
  })
})

describe("reading inside a chosen project", () => {
  test("records of the chosen project only, with the money of the role: the rows of another project of the same person never appear", async () => {
    const m = await mintUser(db, "u-mgr")
    const a = await records(m.token, "tasks", "proj-a")
    expect((a.items as J[]).map((i) => i.id).sort()).toEqual(["t1", "t2", "t3"])
    const a2 = await records(m.token, "tasks", "proj-a2")
    expect(a2.items).toEqual([])
    const lines = await records(m.token, "boq_lines", "proj-a")
    expect((lines.items as J[]).map((i) => i.id).sort()).toEqual(["li1", "li2"])
    const one = await call(db, "ai_work_link_record", [m.token, "tasks", "t1", "proj-a"])
    expect(one).toMatchObject({ id: "t1", title: "Pour slab" })
    expect(await call(db, "ai_work_link_record", [m.token, "tasks", "t1", "proj-a2"])).toBeNull()
  })

  test("the context: user level has no project and only create_project; inside a project it names the project and counts its own submissions", async () => {
    const m = await mintUser(db, "u-mem")
    const top = await call(db, "ai_work_link_context", [m.token, null])
    expect(top).toMatchObject({ scope: "user", project: null, level: 0, allowed_functions: ["create_project"], counters: { submissions: 0 } })
    expect((top.functions as J[]).map((f) => f.id)).toEqual(["create_project"])
    const inside = await call(db, "ai_work_link_context", [m.token, "proj-a"])
    expect(inside).toMatchObject({ scope: "user", project: { id: "proj-a", name: "Villa A" } })
    expect(inside.allowed_functions).not.toContain("create_project")
    expect(inside.allowed_functions).toContain("record_work_progress")
    // money hidden for the member rides on the same context as for a project link
    expect(Object.keys(inside.money_fields)).toContain("boq_lines")
  })
})

describe("drafts", () => {
  test("create_project needs no project: a draft with no project, an intent with a null project, and the link's own 48 hour confirm code", async () => {
    const m = await mintUser(db, "u-mem")
    const d = await intent(m.token, "draft", "create_project", { name: "Marina Club" }, null, null)
    expect(d).toMatchObject({ status: "awaiting_confirmation", kind: "draft", function_id: "create_project", replayed: false })
    expect(d.confirm_token).toMatch(/^[0-9a-f]{64}$/)
    const row = await one<J>(db, "select project_id, org_id, user_id, link_id, function_id, status from platform.ai_work_link_intent where id = $1", [d.intent_id])
    expect(row).toMatchObject({ project_id: null, org_id: "org-a", user_id: "u-mem", link_id: m.link_id, function_id: "create_project", status: "awaiting_confirmation" })
  })

  test("a project link may not record it (FUNCTION_NOT_ON_LINK); a user link inside a project may not either; every other function needs a project", async () => {
    const p = await mintProject(db, "u-mgr", "proj-a")
    expect((await refusedIntent(p.token, "draft", "create_project", { name: "X" }, null, null))?.message).toBe("FUNCTION_NOT_ON_LINK")
    expect((await refusedIntent(p.token, "draft", "create_project", { name: "X" }, null, "proj-a"))?.message).toBe("FUNCTION_NOT_ON_LINK")
    const u = await mintUser(db, "u-mgr")
    expect((await refusedIntent(u.token, "draft", "create_project", { name: "X" }, null, "proj-a"))?.message).toBe("FUNCTION_NOT_ON_LINK")
    expect((await refusedIntent(u.token, "draft", "record_work_progress", { itemCode: "EX-01", percent: 5 }, null, null))?.message).toBe("FUNCTION_NOT_ON_LINK")
    expect(await one<{ n: number }>(db, "select count(*)::int n from platform.ai_work_link_intent where function_id = 'create_project' and link_id = $1", [p.link_id])).toEqual({ n: 0 })
  })

  test("a draft inside a project records that project; a projectId parameter that names another one (or any, with no project) is WRONG_PROJECT", async () => {
    const u = await mintUser(db, "u-mgr")
    const d = await intent(u.token, "draft", "record_work_progress", { itemCode: "EX-01", percent: 5 }, null, "proj-a")
    expect((await one<J>(db, "select project_id from platform.ai_work_link_intent where id = $1", [d.intent_id])).project_id).toBe("proj-a")
    expect((await refusedIntent(u.token, "draft", "record_work_progress", { projectId: "proj-a2", percent: 5 }, null, "proj-a"))?.message).toBe("WRONG_PROJECT")
    expect(await refusedIntent(u.token, "draft", "record_work_progress", { projectId: "proj-a", itemCode: "EX-01", percent: 5 }, "k-own", "proj-a")).toBeNull()
    const top = await mintUser(db, "u-mem")
    expect((await refusedIntent(top.token, "draft", "create_project", { name: "X", projectId: "proj-a" }, null, null))?.message).toBe("WRONG_PROJECT")
  })

  test("the retry key is per project: the same parameters or key in two projects are two drafts, in one project a replay", async () => {
    const u = await mintUser(db, "u-mgr")
    const p = { itemCode: "EX-77", percent: 12 }
    const first = await intent(u.token, "draft", "record_work_progress", p, null, "proj-a")
    const other = await intent(u.token, "draft", "record_work_progress", p, null, "proj-a2")
    const again = await intent(u.token, "draft", "record_work_progress", p, null, "proj-a")
    expect(other.replayed).toBe(false)
    expect(other.intent_id).not.toBe(first.intent_id)
    expect(again).toMatchObject({ replayed: true, intent_id: first.intent_id, confirm_token: null })
    const k1 = await intent(u.token, "draft", "record_work_progress", p, "retry-1", "proj-a")
    const k2 = await intent(u.token, "draft", "record_work_progress", p, "retry-1", "proj-a2")
    const k3 = await intent(u.token, "draft", "record_work_progress", p, "retry-1", "proj-a")
    expect(k2.intent_id).not.toBe(k1.intent_id)
    expect(k3).toMatchObject({ replayed: true, intent_id: k1.intent_id })
  })

  test("a direct action is refused on a user link (level 0 for ever), and create_project is a draft only", async () => {
    const u = await mintUser(db, "u-mgr")
    expect((await refusedIntent(u.token, "action", "record_work_progress", { itemCode: "EX-01", percent: 5 }, null, "proj-a"))?.message).toBe("LEVEL_NOT_ALLOWED")
    expect((await refusedIntent(u.token, "action", "create_project", { name: "X" }, null, null))?.message).toBe("LEVEL_NOT_ALLOWED")
    await setWrites(db, true)
    try {
      expect((await call(db, "ai_work_link__resolve", [u.token])).effective_level).toBe(0)
      expect((await refusedIntent(u.token, "action", "record_work_progress", { itemCode: "EX-01", percent: 5 }, null, "proj-a"))?.message).toBe("LEVEL_NOT_ALLOWED")
    } finally {
      await setWrites(db, false)
    }
  })

  test("5 new projects a person a day: the sixth draft is PROJECT_CAP_DAY (AW429), a replay is not counted, and another person is not limited", async () => {
    const u = await mintUser(db, "u-adm")
    for (let i = 1; i <= 5; i++) await intent(u.token, "draft", "create_project", { name: `Plan ${i}` }, null, null)
    expect(await intent(u.token, "draft", "create_project", { name: "Plan 3" }, null, null)).toMatchObject({ replayed: true })
    expect(await refusedIntent(u.token, "draft", "create_project", { name: "Plan 6" }, null, null)).toMatchObject({ code: "AW429", message: "PROJECT_CAP_DAY" })
    // the cap is the person's, over every link: a new link of the same person is limited too
    const next = await mintUser(db, "u-adm")
    expect(await refusedIntent(next.token, "draft", "create_project", { name: "Plan 7" }, null, null)).toMatchObject({ code: "AW429", message: "PROJECT_CAP_DAY" })
    const other = await mintUser(db, "u-mgr")
    expect(await refusedIntent(other.token, "draft", "create_project", { name: "Plan 1" }, null, null)).toBeNull()
  })
})

describe("confirm and claim", () => {
  let mem: J

  test("the claim of a create_project draft answers ok with NO project and the person; the claim of a project draft answers that project", async () => {
    mem = await mintUser(db, "u-mem")
    await setWrites(db, true)
    try {
      const cp = await intent(mem.token, "draft", "create_project", { name: "Harbour View" }, null, null)
      const conf = await call(db, "ai_work_link_draft_confirm", [cp.intent_id, cp.confirm_token, "u-mem"])
      expect(conf).toMatchObject({ status: "confirmed", intent: { function_id: "create_project", project_id: null, user_id: "u-mem" } })
      const claim = await call(db, "ai_work_link_intent_claim", [cp.intent_id])
      expect(claim).toMatchObject({ status: "ok", intent: { function_id: "create_project", params: { name: "Harbour View" } }, ctx: { link_id: mem.link_id, org_id: "org-a", user_id: "u-mem", project_id: null, live_role: "member" } })

      const wp = await intent(mem.token, "draft", "record_work_progress", { itemCode: "EX-01", percent: 20 }, null, "proj-a2")
      await call(db, "ai_work_link_draft_confirm", [wp.intent_id, wp.confirm_token, "u-mem"])
      const c2 = await call(db, "ai_work_link_intent_claim", [wp.intent_id])
      expect(c2).toMatchObject({ status: "ok", ctx: { project_id: "proj-a2", org_id: "org-a", user_id: "u-mem" } })
    } finally {
      await setWrites(db, false)
    }
  })

  test("a project that stopped being readable between the draft and the click refuses the intent (LINK_GONE) and writes nothing", async () => {
    const u = await mintUser(db, "u-mem")
    await setWrites(db, true)
    try {
      const wp = await intent(u.token, "draft", "record_work_progress", { itemCode: "EX-02", percent: 30 }, null, "proj-a2")
      await call(db, "ai_work_link_draft_confirm", [wp.intent_id, wp.confirm_token, "u-mem"])
      await db.exec("update compliance.projects set access_level = 'private' where id = 'proj-a2'")
      const claim = await call(db, "ai_work_link_intent_claim", [wp.intent_id])
      expect(claim).toEqual({ status: "refused", reason: "LINK_GONE" })
      expect((await one<J>(db, "select status, failure from platform.ai_work_link_intent where id = $1", [wp.intent_id]))).toMatchObject({ status: "refused", failure: { code: "LINK_GONE" } })
    } finally {
      await db.exec("update compliance.projects set access_level = 'public' where id = 'proj-a2'")
      await setWrites(db, false)
    }
  })

  test("a create_project draft whose person lost the member rank is refused ROLE_CHANGED at the claim", async () => {
    const u = await mintUser(db, "u-mem")
    await setWrites(db, true)
    try {
      const cp = await intent(u.token, "draft", "create_project", { name: "Late Demotion" }, null, null)
      await call(db, "ai_work_link_draft_confirm", [cp.intent_id, cp.confirm_token, "u-mem"])
      await db.exec("update compliance.users set role = 'viewer' where id = 'u-mem'")
      expect(await call<J>(db, "ai_work_link_intent_claim", [cp.intent_id])).toEqual({ status: "refused", reason: "ROLE_CHANGED" })
    } finally {
      await db.exec("update compliance.users set role = 'member' where id = 'u-mem'")
      await setWrites(db, false)
    }
  })

  test("the claim of a PROJECT link's intent is as it was: the link's project, and a create_project row planted on a project link is refused ROLE_CHANGED", async () => {
    const p = await mintProject(db, "u-mgr", "proj-a", { level: 0 })
    await setWrites(db, true)
    try {
      const d = await intent(p.token, "draft", "record_work_progress", { itemCode: "EX-03", percent: 40 }, null, null)
      await call(db, "ai_work_link_draft_confirm", [d.intent_id, d.confirm_token, "u-mgr"])
      expect(await call(db, "ai_work_link_intent_claim", [d.intent_id])).toMatchObject({ status: "ok", ctx: { project_id: "proj-a", user_id: "u-mgr" } })
      // a row the SQL itself would never record (the table is revoked from every role): even then the claim does not run it
      await db.exec(
        `insert into platform.ai_work_link_intent (id, link_id, org_id, project_id, user_id, function_id, params, kind, idempotency_key, status, expires_at, confirmed_by)
         values ('planted', '${p.link_id}', 'org-a', 'proj-a', 'u-mgr', 'create_project', '{}', 'draft', 'planted', 'confirmed', now() + interval '1 day', 'u-mgr')`,
      )
      expect(await call<J>(db, "ai_work_link_intent_claim", ["planted"])).toEqual({ status: "refused", reason: "ROLE_CHANGED" })
    } finally {
      await setWrites(db, false)
    }
  })
})

describe("grants and shape", () => {
  test("every new function is SECURITY DEFINER or owner-only, pinned to search_path pg_catalog, pg_temp; service_role runs the public ones and nobody else runs any", async () => {
    const r = await db.query<{ n: string; args: string; definer: boolean; cfg: string[] | null; anon: boolean; auth: boolean; app: boolean; svc: boolean; pub: boolean }>(
      `select p.proname n, pg_get_function_identity_arguments(p.oid) args, p.prosecdef definer, p.proconfig cfg,
              has_function_privilege('anon', p.oid, 'EXECUTE') anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') auth,
              has_function_privilege('app_runtime', p.oid, 'EXECUTE') app, has_function_privilege('service_role', p.oid, 'EXECUTE') svc,
              coalesce((select bool_or(a.grantee = 0) from aclexplode(p.proacl) a), true) pub
       from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public' and (p.proname = any ($1) or p.proname in ('ai_work_link_records', 'ai_work_link_record', 'ai_work_link_context', 'ai_work_link_record_intent', 'ai_work_link_intent_claim', 'ai_work_link__resolve', 'ai_work_link__live', 'ai_work_link_list_for'))
       order by 1, 2`,
      [NEW_FUNCTIONS],
    )
    expect(r.rows.length).toBe(NEW_FUNCTIONS.length + 8)
    const ownerOnly = ["ai_work_link__bind", "ai_work_link__fns", "ai_work_link__require_in", "ai_work_link__live"]
    for (const x of r.rows) {
      expect({ n: x.n, anon: x.anon, auth: x.auth, app: x.app, pub: x.pub }).toEqual({ n: x.n, anon: false, auth: false, app: false, pub: false })
      expect({ n: x.n, svc: x.svc }).toEqual({ n: x.n, svc: !ownerOnly.includes(x.n) })
      expect(x.cfg).toContain("search_path=pg_catalog, pg_temp")
    }
    // the ones that take a token or a project from outside run as the owner
    for (const x of r.rows.filter((y) => !["ai_work_link__fns", "ai_work_link__require_in"].includes(y.n))) expect({ n: x.n, definer: x.definer }).toEqual({ n: x.n, definer: true })
  })

  test("the journal has both entries in order, after 0667, with a down file each; 0669's block is the whole registry with create_project at level 2", async () => {
    const journal = JSON.parse((await Bun.file(new URL("../../../drizzle/meta/_journal.json", import.meta.url)).text())) as { entries: Array<{ idx: number; when: number; tag: string }> }
    const mine = USER_LINK_MIGRATIONS.map((t) => journal.entries.find((e) => e.tag === t)!)
    expect(mine.every(Boolean)).toBe(true)
    const prev = journal.entries.find((e) => e.tag.startsWith("0667_"))!
    expect(mine[0].when).toBeGreaterThan(prev.when)
    expect(mine[1].when).toBeGreaterThan(mine[0].when)
    expect(mine[1].idx).toBe(mine[0].idx + 1)
    for (const t of USER_LINK_MIGRATIONS) expect(downSql(t).length).toBeGreaterThan(200)
    const cp = await one<J>(db, "select function_id, link_level::int link_level, min_role_rank::int min_role_rank, money_sensitive, excluded_reason, text_params from platform.ai_work_link_functions where function_id = 'create_project'")
    expect(cp).toEqual({ function_id: "create_project", link_level: 2, min_role_rank: 2, money_sensitive: false, excluded_reason: null, text_params: ["name", "description"] })
    expect((await one<{ n: number }>(db, "select count(*)::int n from platform.ai_work_link_functions where link_level is not null")).n).toBe(95)
    expect((await one<{ v: string }>(db, "select public.ai_work_link__registry_version() v")).v).toMatch(/^[0-9a-f]{64}$/)
  })

  test("applying both migrations again changes nothing (idempotent)", async () => {
    const before = await one<J>(db, "select count(*)::int n, (select count(*)::int from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'ai\\_work\\_link%') f from platform.user_ai_links")
    for (const t of USER_LINK_MIGRATIONS) await db.exec(forwardSql(t))
    expect(await one<J>(db, "select count(*)::int n, (select count(*)::int from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname like 'ai\\_work\\_link%') f from platform.user_ai_links")).toEqual(before)
    expect((await call(db, "ai_work_link__resolve", [(await mintUser(db, "u-adm")).token])).scope).toBe("user")
  })
})

describe("the down files", () => {
  test("0669 down puts create_project back on no link; 0668 down REFUSES while a user link exists and changes nothing; once none is left it restores every old function and signature; the forward files apply again", async () => {
    const d = await createUserLinkDb()
    try {
      const m = await mintUser(d, "u-mem")
      const p = await mintProject(d, "u-mgr", "proj-a")
      const sig = async () =>
        (await d.query<{ s: string }>(
          "select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' s from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'public' and p.proname like 'ai\\_work\\_link%' order by 1",
        )).rows.map((r) => r.s)
      const withNew = await sig()
      for (const f of NEW_FUNCTIONS) expect(withNew.some((s) => s.startsWith(f + "("))).toBe(true)

      await d.exec(downSql("0669_awl_seed_user_link_create_project"))
      expect(await one<J>(d, "select link_level, min_role_rank::int r, text_params, excluded_reason from platform.ai_work_link_functions where function_id = 'create_project'")).toMatchObject({ link_level: null, r: 0, text_params: [] })
      expect((await one<{ v: string }>(d, "select public.ai_work_link__registry_version() v")).v).toBe("3e91138670810d93780d17569f7c4d8b514d4fede563047d7f626d7eddabbed5")

      const e = await refused(d, "select 1") // keep the connection honest, then run the refusing down file
      expect(e).toBeNull()
      let refusal = ""
      try {
        await d.exec(downSql("0668_awl_user_wide_link"))
      } catch (err) {
        refusal = String((err as Error).message)
        await d.exec("ROLLBACK") // the file's own BEGIN was left open by the exception; the PM's run is one transaction that aborts
      }
      expect(refusal).toContain("0668 down refuses")
      expect(await sig()).toEqual(withNew)
      expect((await call(d, "ai_work_link__resolve", [m.token])).scope).toBe("user")

      await d.exec("delete from platform.ai_work_link_call where link_id = '" + m.link_id + "'")
      await d.exec("delete from platform.ai_work_link_intent where link_id in (select id from platform.user_ai_links where scope = 'user')")
      await d.exec("delete from platform.user_ai_links where scope = 'user'")
      await d.exec(downSql("0668_awl_user_wide_link"))
      await d.exec(downSql("0668_awl_user_wide_link")) // twice

      const after = await sig()
      for (const f of NEW_FUNCTIONS) expect(after.some((s) => s.startsWith(f + "("))).toBe(false)
      expect(after).toContain("ai_work_link_records(p_token text, p_kind text, p_after text, p_limit integer, p_filters jsonb)")
      expect(after).toContain("ai_work_link_context(p_token text)")
      expect(after).toContain("ai_work_link_record_intent(p_token text, p_kind text, p_function_id text, p_params jsonb, p_idempotency_key text)")
      expect(await one<J>(d, "select count(*)::int n from information_schema.columns where table_schema = 'platform' and table_name = 'user_ai_links' and column_name = 'scope'")).toEqual({ n: 0 })
      expect((await one<{ n: string }>(d, "select is_nullable n from information_schema.columns where table_schema = 'platform' and table_name = 'ai_work_link_intent' and column_name = 'project_id'")).n).toBe("NO")
      // the project link made before still works, with the old functions
      const r = await call(d, "ai_work_link__resolve", [p.token])
      expect(r).toMatchObject({ status: "ok", project_id: "proj-a" })
      expect(r.scope).toBeUndefined()
      expect((await call(d, "ai_work_link_records", [p.token, "tasks", null, 50, "{}"])).kind).toBe("tasks")

      for (const t of USER_LINK_MIGRATIONS) await d.exec(forwardSql(t))
      expect((await call(d, "ai_work_link__resolve", [p.token])).scope).toBe("project")
      expect((await call(d, "ai_work_link__resolve", [(await mintUser(d, "u-mem")).token])).scope).toBe("user")
    } finally {
      await d.close()
    }
  })
})
