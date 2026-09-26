// PROJEXA-BUILD-002 WP-14 (register rows AW-603, AW-701 to AW-703): the WORLD the persona run acts in, for the local execution host in dry mode
// (`scripts/awl-local-exec-host.ts --dry --seed persona`). Nothing here leaves the machine and no database or secret is used.
//
// TWO databases, as in the deployed system:
//   * the BUSINESS side is the tenant store double of src/lib/pipeline/__test-helpers__/boq-store-double.ts (the real drizzle where clauses are
//     compiled and evaluated against rows; a transaction commits when it returns and is discarded when it throws). The REAL services run on it.
//   * the LINK side is real SQL on PGlite (migrations 0621 to 0631, the seeds 0644 and 0647 to 0650 and the record kinds 0643 over the schema-only
//     base snapshots): the link, the intents, the drafts, the record reads (`public.ai_work_link_read_records`) and the mint functions.
// The record reads of the link read the link-side tables, so after every applied change `mirror()` copies the business rows into them (a stand-in
// for the one shared Postgres of production: an AI reads back what it wrote). The mirror moves rows; it decides nothing.
//
// THE PROJECT COMES IN THE WAY ONE: the ZOOMIES workbook (built from the public fixture, src/lib/ingest/__fixtures__/zoomies-digest.json: no bank
// details, no client data) goes through createProjectFromDocument(): the WP-01 deterministic reader, the WP-02 contract (the real Edge handler
// with the test stand-in model, no live model) and then the real createProject() and createBoq(). Only after that does the AI get a link.
//
// PEOPLE. Sumeet (manager, sees money), Maya (member, rank 2, no money) and Vic (viewer), all of organisation "org_zoomies". PROJECTS. The ZOOMIES
// project (created above), "Oakwood" (another project of the same organisation, with an RFI, a roster entry and a BOQ of its own) and "Elsewhere"
// (a project of another organisation). Those are the decoys the persona run tries and must be refused.
/// <reference types="bun-types" />
import { mock } from "bun:test"
import { getTableColumns, getTableName, is, Table } from "drizzle-orm"
import type { PGlite } from "@electric-sql/pglite"
import * as schema from "@/lib/db/schema"
import { makeBoqStore, seedRows, type BoqStore, type Row } from "@/lib/pipeline/__test-helpers__/boq-store-double"
import { coverageWithTenantContext } from "@/lib/pipeline/__test-helpers__/coverage-fixtures"

export const ORG = "org_zoomies"
export const OTHER_ORG = "org_elsewhere"
export const PEOPLE = {
  sumeet: { id: "person_sumeet", name: "Sumeet Rao", email: "sumeet@zoomies.example.test", role: "manager", authId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa" },
  maya: { id: "person_maya", name: "Maya Iyer", email: "maya@zoomies.example.test", role: "member", authId: "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb" },
  vic: { id: "person_vic", name: "Vic Nair", email: "vic@zoomies.example.test", role: "viewer", authId: "cccccccc-3333-4333-8333-cccccccccccc" },
  other: { id: "person_other", name: "Olga Other", email: "olga@elsewhere.example.test", role: "manager", authId: "dddddddd-4444-4444-8444-dddddddddddd" },
} as const
export type PersonKey = keyof typeof PEOPLE
export const PRODUCT = "product_construction"
export const OAKWOOD = "project_oakwood"
export const ELSEWHERE = "project_elsewhere"

// the link-side tables the mirror fills (a table the link side does not have is skipped)
const MIRRORED = [
  "projects", "construction_boqs", "construction_boq_line_items", "construction_categories", "construction_activities", "construction_work_progress_entries",
  "construction_labour_roster", "construction_attendance", "construction_materials", "construction_material_receipts", "construction_material_issues",
  "construction_rfis", "construction_submittals", "construction_punch_list_items", "construction_site_diaries", "construction_change_orders",
  "construction_site_instructions", "construction_milestones", "construction_progress_claims", "construction_interim_bills", "construction_drawings",
  "construction_permits", "construction_kpi_entries", "construction_kpi_definitions", "construction_schedule_baselines", "construction_wiki_pages",
  "construction_ffe_items", "pms_issues", "pms_meetings", "pms_time_entries", "documents", "submissions", "pipeline_tasks",
] as const

export type World = Awaited<ReturnType<typeof buildWorld>>

/**
 * `createZoomies` true (the default): the project is created the way one creates it, before the AI arrives. False ("persona-empty", way three): the
 * organisation has no ZOOMIES project; the person makes a shell project with "New project with my AI" and the AI fills it in through its link.
 */
export async function buildWorld(opts: { createZoomies: boolean } = { createZoomies: true }) {
  // 1. the business side: replace withTenantContext BEFORE any service is imported
  let store: BoqStore = makeBoqStore()
  store.serialise = true
  const realTenantScoped = await import("@/lib/db/tenant-scoped")
  // The store double does not model a raw `insert ... on conflict ... returning` (the per-organisation worker-code counter of the labour service, 0529): it
  // answers one from a counter of its own, the way the counter row would. This is the double's gap, not the product's.
  const baseContext = coverageWithTenantContext(() => store)
  const counters = new Map<string, number>()
  const withRawCounters = (db: any) => ({
    ...db,
    execute: async (statement?: any) => {
      if (statement) {
        const { PgDialect } = await import("drizzle-orm/pg-core")
        const q = new PgDialect().sqlToQuery(statement)
        if (/construction_employee_code_counters/.test(q.sql)) {
          const org = String(q.params[0])
          counters.set(org, (counters.get(org) ?? 0) + 1)
          return [{ last_number: counters.get(org) }]
        }
      }
      return db.execute(statement)
    },
  })
  mock.module("@/lib/db/tenant-scoped", () => ({
    ...realTenantScoped,
    withTenantContext: (ctx: unknown, fn: (db: unknown) => Promise<unknown>) => baseContext(ctx, (db) => fn(withRawCounters(db))),
  }))
  // the memory write is a database call of its own (RLS policies, an actor check): out of scope for the in-memory business side
  const realMemory = await import("@/lib/services/memory-service")
  mock.module("@/lib/services/memory-service", () => ({ ...realMemory, createMemoryRecord: async () => ({ id: "dry-memory" }) }))

  for (const p of Object.values(PEOPLE)) {
    seedRows(store, "users", [{ id: p.id, orgId: p.id === PEOPLE.other.id ? OTHER_ORG : ORG, isActive: true, role: p.role, name: p.name, email: p.email }])
  }
  seedRows(store, "products", [{ id: PRODUCT, orgId: ORG, name: "Construction", slug: "construction" }])
  seedRows(store, "projects", [
    { id: OAKWOOD, orgId: ORG, productId: PRODUCT, name: "Oakwood", status: "active", leadUserId: PEOPLE.sumeet.id },
    { id: ELSEWHERE, orgId: OTHER_ORG, productId: PRODUCT, name: "Elsewhere", status: "active", leadUserId: PEOPLE.other.id },
  ])
  seedRows(store, "construction_boqs", [
    { id: "boq_oakwood", orgId: ORG, projectId: OAKWOOD, version: 1, title: "Oakwood BOQ", createdById: PEOPLE.sumeet.id },
    { id: "boq_elsewhere", orgId: OTHER_ORG, projectId: ELSEWHERE, version: 1, title: "Elsewhere BOQ", createdById: PEOPLE.other.id },
  ])
  seedRows(store, "construction_labour_roster", [
    { id: "roster_oakwood", orgId: ORG, projectId: OAKWOOD, name: "Babu (Oakwood)", trade: "Mason", dailyRate: "900", isActive: true },
    { id: "roster_elsewhere", orgId: OTHER_ORG, projectId: ELSEWHERE, name: "Chandra (Elsewhere)", trade: "Mason", dailyRate: "950", isActive: true },
  ])
  seedRows(store, "construction_rfis", [
    { id: "rfi_oakwood", orgId: ORG, projectId: OAKWOOD, number: 1, subject: "Slab edge", question: "Confirm edge", status: "open", ballInCourt: "architect", raisedById: PEOPLE.sumeet.id },
    { id: "rfi_elsewhere", orgId: OTHER_ORG, projectId: ELSEWHERE, number: 1, subject: "Other organisation", question: "Other", status: "open", ballInCourt: "architect", raisedById: PEOPLE.other.id },
  ])
  seedRows(store, "construction_materials", [
    { id: "material_oakwood", orgId: ORG, projectId: OAKWOOD, name: "Steel TMT", unit: "kg", unitCost: "60", isActive: true },
  ])

  // 2. the WAY-ONE creation: the reader, the contract, then the real createProject and createBoq
  const { zoomiesWorkbook } = await import("@/lib/services/__test-helpers__/zoomies-workbook")
  const { edgeCallerFor, edgeDeps, memoryLedger } = await import("@/lib/services/__test-helpers__/document-extraction-fixtures")
  const { carefulHumanModel } = await import("@/lib/services/__test-helpers__/zoomies-standin-model")
  const { createProjectFromDocument } = await import("@/lib/services/document-extraction-service")
  const { createProject } = await import("@/lib/services/construction-dashboard-service")
  const { createBoq } = await import("@/lib/services/construction-boq-service")
  const created = opts.createZoomies
    ? await createProjectFromDocument(
        { orgId: ORG, actorId: PEOPLE.sumeet.id, productId: PRODUCT, fileName: "SMD ZOOMIES.xlsx", bytes: zoomiesWorkbook(), acknowledgeQuestions: true },
        { callEdge: edgeCallerFor(edgeDeps(carefulHumanModel)), ledger: memoryLedger().ledger, createProject, createBoq },
      )
    : null
  if (created && (created.duplicate || "pending" in created)) throw new Error("persona-world: the ZOOMIES workbook was not created (a duplicate, or parked for answers)")
  const zoomiesId = created ? created.projectId : ""
  const zoomiesBoqId = created ? (created.boq as { id: string }).id : ""
  // The organisation's own set-up and the colleagues' work that was there BEFORE the AI arrived: the default task type of the org (every real org has one),
  // and a shop-drawing submittal that Maya raised on the ZOOMIES project (a submittal cannot be reviewed by the person who raised it).
  seedRows(store, "pms_issue_types", [{ id: "type_task", orgId: ORG, name: "Task", isDefault: true }])
  if (created) {
    // the client the project bills, and the KPI the office tracks on it (set up by the office, not by the AI)
    for (const pr of store.tables.projects ?? []) if (pr.id === zoomiesId) pr.clientId = "client_zoomies"
    seedRows(store, "erp_customers", [{ id: "customer_zoomies", orgId: ORG, customerName: "ZOOMIES client", clientId: "client_zoomies", isActive: true }])
    seedRows(store, "construction_kpi_definitions", [{ id: "kpi_progress", orgId: ORG, projectId: zoomiesId, metricName: "Weekly progress, percent", targetValue: "100", unit: "%", period: "monthly", ownerId: PEOPLE.sumeet.id }])
    // Maya's submitted timesheet for the week, waiting for the manager (a time entry is a draft until its owner submits it, and no link function submits one)
    seedRows(store, "pms_issues", [{ id: "issue_setout", orgId: ORG, projectId: zoomiesId, typeId: "type_task", statusId: "status_open", number: 1, title: "Partition set-out, vet area", createdById: PEOPLE.maya.id }])
    seedRows(store, "pms_time_entries", [{ id: "time_maya", orgId: ORG, issueId: "issue_setout", userId: PEOPLE.maya.id, hours: "6.00", spentOn: "2026-09-25", approvalStatus: "submitted" }])
    seedRows(store, "construction_submittals", [
      { id: "submittal_maya", orgId: ORG, projectId: zoomiesId, number: 1, title: "Partition board sample, vet area", type: "sample", status: "pending", submittedById: PEOPLE.maya.id },
    ])
  }

  // 3. the link side: real SQL on PGlite
  const { createAwlDb, forwardSql, read } = await import("@/lib/services/__test-helpers__/awl-pglite")
  const { rpcFor, setWrites } = await import("@/lib/services/__test-helpers__/awl-write-fixture")
  const db: PGlite = await createAwlDb("0630")
  await db.exec(forwardSql("0618_build001_projexa_gateway")) // projexa_read_resolve_user: who a signed-in session is
  await db.exec(`create table if not exists compliance.products (
    id text primary key default (gen_random_uuid())::text, org_id text not null, name text not null, slug text not null, description text,
    is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
    insert into compliance.products (id, org_id, name, slug) values ('${PRODUCT}', '${ORG}', 'Construction', 'construction'), ('${PRODUCT}_2', '${OTHER_ORG}', 'Construction', 'construction')`)
  await db.exec(forwardSql("0631_build001_awl_mint_for"))
  await db.exec(read("scripts/verify/fixtures/0643_build002_record_kinds.base.sql"))
  // the order of drizzle/meta/_journal.json (0644, 0643, 0650, 0647, 0648, 0649): each seed names its own set and deletes the rest, so the LAST one
  // (0649, all 112 functions) is the whole truth. Applying them in file-number order would end on 0650, which names only waves 1 and 2.
  for (const name of ["0644_build002_awl_seed_project_boq", "0643_build002_record_kinds", "0650_build002_awl_seed_coverage_waves_1_2", "0647_build002_awl_seed_waves_3_4", "0648_build002_awl_seed_waves_5_6", "0649_build002_awl_seed_waves_7_9"]) {
    await db.exec(forwardSql(name))
  }
  await setWrites(db, true)
  // the link side keeps rows the business side copied over in table order; its foreign keys to tables the mirror does not carry are not checked
  await db.exec("set session_replication_role = replica")
  for (const p of Object.values(PEOPLE)) {
    await db.query("insert into compliance.users (id, name, email, password_hash, role, is_active, org_id, auth_user_id) values ($1, $2, $3, 'x', $4, true, $5, $6)", [
      p.id, p.name, p.email, p.role, p.id === PEOPLE.other.id ? OTHER_ORG : ORG, p.authId,
    ])
  }
  await db.exec(`insert into compliance.cost_visibility_config (id, org_id, role, can_see_cost, changed_by_id) values
    ('cv_manager', '${ORG}', 'manager', true, '${PEOPLE.sumeet.id}'), ('cv_member', '${ORG}', 'member', false, '${PEOPLE.sumeet.id}'), ('cv_viewer', '${ORG}', 'viewer', false, '${PEOPLE.sumeet.id}')`)

  // 4. the mirror
  const tableFor = (sqlName: string): Table | undefined => Object.values(schema).find((t) => is(t, Table) && getTableName(t) === sqlName) as Table | undefined
  const linkColumns = new Map<string, Set<string>>()
  const columnsOf = async (t: string): Promise<Set<string>> => {
    if (!linkColumns.has(t)) {
      const r = await db.query<{ column_name: string }>("select column_name from information_schema.columns where table_schema = 'compliance' and table_name = $1", [t])
      linkColumns.set(t, new Set(r.rows.map((x) => x.column_name)))
    }
    return linkColumns.get(t) as Set<string>
  }
  const skipped = new Set<string>()
  const literal = (v: unknown): unknown => (v instanceof Date ? v.toISOString() : v !== null && typeof v === "object" ? JSON.stringify(v) : v)
  async function mirror(): Promise<void> {
    // deleted children first, inserted parents first (the link side keeps its foreign keys)
    for (const name of [...MIRRORED].reverse()) {
      if (name !== "projects" && (await columnsOf(name)).size > 0) await db.exec(`delete from compliance.${name}`)
    }
    for (const name of MIRRORED) {
      const table = tableFor(name)
      const have = await columnsOf(name)
      if (!table || have.size === 0) continue
      const cols = Object.entries(getTableColumns(table)).filter(([, c]) => have.has((c as { name: string }).name)) as Array<[string, { name: string }]>
      if (name === "projects") continue // projects are upserted below, never deleted (links point at them)
      for (const row of (store.tables[name] ?? []) as Row[]) {
        const names = cols.map(([, c]) => `"${c.name}"`)
        const values = cols.map(([k]) => literal(row[k] ?? null))
        try {
          await db.query(`insert into compliance.${name} (${names.join(", ")}) values (${names.map((_, i) => `$${i + 1}`).join(", ")}) on conflict do nothing`, values)
        } catch (e) {
          if (!skipped.has(name)) {
            skipped.add(name)
            console.error(`persona-world: mirror: a ${name} row could not be copied (${String((e as Error).message).slice(0, 120)}); later rows of it are tried too`)
          }
        }
      }
    }
    await columnsOf("projects")
    const have = linkColumns.get("projects") as Set<string>
    const usable = Object.entries(getTableColumns(schema.projects)).filter(([, c]) => have.has((c as { name: string }).name)) as Array<[string, { name: string }]>
    for (const row of (store.tables.projects ?? []) as Row[]) {
      const names = usable.map(([, c]) => `"${c.name}"`)
      const values = usable.map(([k]) => literal(row[k] ?? null))
      try {
        await db.query(`insert into compliance.projects (${names.join(", ")}) values (${names.map((_, i) => `$${i + 1}`).join(", ")}) on conflict (id) do nothing`, values)
      } catch (e) {
        throw new Error(`persona-world: a project could not be copied to the link side: ${String((e as Error).message).slice(0, 200)}`)
      }
    }
  }
  await mirror()

  /** A project the link side made (the "New project with my AI" route writes to it) is copied to the business side before a change runs on it. */
  async function pull(): Promise<void> {
    const have = new Set(((store.tables.projects ?? []) as Row[]).map((r) => String(r.id)))
    const cols = Object.entries(getTableColumns(schema.projects)) as Array<[string, { name: string }]>
    const rows = (await db.query<Record<string, unknown>>("select * from compliance.projects")).rows
    for (const r of rows) {
      if (have.has(String(r.id))) continue
      const row: Row = {}
      for (const [key, col] of cols) if (r[col.name] !== undefined) row[key] = r[col.name] instanceof Date ? r[col.name] : r[col.name]
      seedRows(store, "projects", [{ status: "active", ...row }])
    }
  }

  // 5. sessions: a bearer per person that the local session verifier accepts (production verifies an ES256 token of the Auth service)
  const sessions = new Map<string, { sub: string; email: string }>()
  const sessionFor = (who: PersonKey): string => {
    const token = `dry-session-${who}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
    sessions.set(token, { sub: PEOPLE[who].authId, email: PEOPLE[who].email })
    return token
  }
  // ONE clock for the signed-in routes (the per-person brakes and the fresh-session rule read it); a run advances it instead of waiting for real minutes
  let offsetMs = 0
  const clock = { now: () => Date.now() + offsetMs, advance: (ms: number) => { offsetMs += ms } }
  const verify = async (token: string) => {
    const s = sessions.get(token)
    return s ? ({ ok: true, sub: s.sub, email: s.email, issuer: "dry-run", iat: Math.floor(clock.now() / 1000) } as const) : ({ ok: false, reason: "invalid" } as const)
  }

  const setRole = async (who: PersonKey, role: string): Promise<void> => {
    await db.query("update compliance.users set role = $2 where id = $1", [PEOPLE[who].id, role])
    for (const u of store.tables.users ?? []) if (u.id === PEOPLE[who].id) u.role = role
  }
  const roleOf = async (who: PersonKey): Promise<string> => String((await db.query<{ role: string }>("select role from compliance.users where id = $1", [PEOPLE[who].id])).rows[0]?.role)

  return {
    db,
    store: () => store,
    rpc: rpcFor(db),
    setWrites: (on: boolean) => setWrites(db, on),
    mirror,
    pull,
    clock,
    sessionFor,
    verify,
    setRole,
    roleOf,
    ids: { org: ORG, zoomiesProject: zoomiesId, zoomiesBoq: zoomiesBoqId, oakwoodProject: OAKWOOD, elsewhereProject: ELSEWHERE },
    /** what way one created, for the run's opening assertions */
    created: { projectId: zoomiesId, boqId: zoomiesBoqId, questions: created && !created.duplicate && !("pending" in created) ? (created.questions?.length ?? 0) : 0 },
  }
}
