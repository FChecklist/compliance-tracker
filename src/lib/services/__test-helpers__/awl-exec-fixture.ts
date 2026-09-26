// PROJEXA-BUILD-002 WP-09b: what the exec-function tests share (ai-work-link-exec.test.ts, ai-work-link-exec-scope.test.ts, the local execution host).
//
// TWO databases meet here, as they do live:
//   * the INTENT side is real SQL on PGlite (awl-write-fixture.ts: migrations 0621 to 0630): record_intent, claim, finish, the live role. It runs as the
//     service-role rpc of the exec handler.
//   * the BUSINESS side is the fake tenant database of src/lib/pipeline/fake-tenant-db.ts (it compiles the REAL drizzle where clauses and records every
//     write), standing in for withTenantContext. The pipeline (runDirectTask, validate(), the executors) is REAL.
// Both name the same people and projects: organisation org_1, the manager user_1, projects project_a (the link's) and project_b (another project).
import { mock } from "bun:test"
import type { PGlite } from "@electric-sql/pglite"
import { createFakeStore, fakeFixtures, makeFakeWithTenantContext, FAKE_ORG, FAKE_PROJECT_A, FAKE_PROJECT_B, FAKE_USER, type FakeStore, type Tables } from "@/lib/pipeline/fake-tenant-db"

export { FAKE_ORG, FAKE_PROJECT_A, FAKE_PROJECT_B, FAKE_USER }
export const EXEC_AUTH_ID = "77777777-7777-4777-8777-777777777777"

/** The business fixtures: the fake tenant database's own plus the records the id-taking link functions look up (an issue, a BOQ line, an activity). */
export function execTables(): Tables {
  const t = fakeFixtures()
  return {
    ...t,
    pms_issues: [
      { id: "issue_a", orgId: FAKE_ORG, projectId: FAKE_PROJECT_A, number: 12, title: "Joinery shop drawings" },
      { id: "issue_b", orgId: FAKE_ORG, projectId: FAKE_PROJECT_B, number: 7, title: "Facade cladding" },
    ],
    pms_time_entries: [],
    construction_boq_line_items: [
      { id: "line_a", boqId: "boq_a", itemCode: "EX-01", quantity: "10" },
      { id: "line_b", boqId: "boq_b", itemCode: "EX-01", quantity: "10" },
    ],
    construction_activities: [{ id: "act_a", orgId: FAKE_ORG, projectId: FAKE_PROJECT_A }],
  }
}

/** The person and the two projects of the business fixtures, in the intent database (so a link can be minted for them). */
export async function seedExecPeople(db: PGlite): Promise<void> {
  await db.exec(`
    insert into compliance.users (id, name, email, password_hash, role, is_active, org_id, auth_user_id) values
      ('${FAKE_USER}', 'Asha M', 'asha@example.test', 'x', 'manager', true, '${FAKE_ORG}', '${EXEC_AUTH_ID}');
    insert into compliance.projects (id, product_id, org_id, name, lead_user_id, access_level) values
      ('${FAKE_PROJECT_A}', 'prod', '${FAKE_ORG}', 'Cedar Heights', '${FAKE_USER}', 'public'),
      ('${FAKE_PROJECT_B}', 'prod', '${FAKE_ORG}', 'Oakwood', '${FAKE_USER}', 'public');
  `)
}

export type ExecMocks = {
  /** The Level 1 model lane: it must never run for a link. */
  runLevel1: ReturnType<typeof mock>
  /** createMemoryRecord: its calls show what a link write leaves in memory. */
  createMemoryRecord: ReturnType<typeof mock>
  restore: () => Promise<void>
}

/**
 * Replaces the tenant database, the Level 1 lane and the memory write. Call BEFORE the first dynamic import of the pipeline (link-exec-entry).
 * `getStore` returns the CURRENT fake store, so a test can swap it in beforeEach.
 */
export async function installExecMocks(getStore: () => FakeStore): Promise<ExecMocks> {
  const realTenantScoped = await import("@/lib/db/tenant-scoped")
  mock.module("@/lib/db/tenant-scoped", () => ({ ...realTenantScoped, withTenantContext: mock(makeFakeWithTenantContext(getStore)) }))
  const realLevel1 = await import("@/lib/pipeline/level1")
  const runLevel1 = mock(async (texts: string[]) => ({ resolutions: texts.map(() => null), reasons: texts.map(() => "spy"), modelCalls: 1 }))
  mock.module("@/lib/pipeline/level1", () => ({ ...realLevel1, runLevel1 }))
  const realMemory = await import("@/lib/services/memory-service")
  const createMemoryRecord = mock(async (..._args: unknown[]) => ({ id: "memory_1" }))
  mock.module("@/lib/services/memory-service", () => ({ ...realMemory, createMemoryRecord }))
  return {
    runLevel1,
    createMemoryRecord,
    restore: async () => {
      mock.restore()
      await mock.module("@/lib/db/tenant-scoped", () => realTenantScoped)
      await mock.module("@/lib/pipeline/level1", () => realLevel1)
      await mock.module("@/lib/services/memory-service", () => realMemory)
    },
  }
}

export const freshStore = (): FakeStore => createFakeStore(execTables())
