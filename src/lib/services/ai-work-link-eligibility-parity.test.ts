/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-46 step 1 (BR-489, spec AWL-D14): the SQL minting rule of the Universal AI Work Link equals canReadProject.
//
// canReadProject (src/lib/services/product-service.ts) is the app's one project-read rule: a project that is not 'private' is readable
// by every member of the organisation; a private one only by an admin (rank 5 and above) or the project's lead. The link's SQL keeps a
// copy of it in public.ai_work_link__can_read_project (drizzle/0624), and uses it twice: to decide whether a link may be minted
// (ai_work_link__eligibility) and, on every call, whether the link still resolves (ai_work_link__resolve). Two copies of a security
// rule drift, so this test runs BOTH over the same matrix and asserts that they agree:
//   - 11 roles (every value of the user_role enum, the keys of ROLE_RANK) x public and private x the person is the lead or is not,
//     plus no person at all, an unknown role, and a private project with no lead;
//   - the rank table itself (ai_work_link__role_rank against ROLE_RANK for every role);
//   - end to end through the two functions that use the rule: minting succeeds exactly when canReadProject is true, and after the
//     project is turned private a link resolves exactly when canReadProject is true for the same person.
// The SQL runs on PGlite (real Postgres as WASM) over the committed base snapshot of the live tables; nothing touches a live database.
import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test"
import type { PGlite } from "@electric-sql/pglite"
import { canReadProject } from "./product-service"
import { ROLE_RANK, type UserRole } from "@/lib/supabase/role-rank"
import type { users, projects } from "@/lib/db"
import { createAwlDb, failure, one } from "./__test-helpers__/awl-pglite"

// PGlite tests run real Postgres as WASM: a loaded laptop or CI runner can pass bun's 5 s default for one test
setDefaultTimeout(60_000)

type DbUser = typeof users.$inferSelect
type Project = Pick<typeof projects.$inferSelect, "accessLevel" | "leadUserId">

const ALL_ROLES = Object.keys(ROLE_RANK) as UserRole[]
const ACCESS = ["public", "private"] as const

const asUser = (id: string, role: string) => ({ id, role }) as unknown as DbUser
const asProject = (accessLevel: string | null, leadUserId: string | null) => ({ accessLevel, leadUserId }) as unknown as Project

let db: PGlite

const sqlCanRead = async (access: string | null, lead: string | null, userId: string | null, role: string | null) =>
  (await one<{ v: boolean }>(db, "select public.ai_work_link__can_read_project($1, $2, $3, $4) v", [access, lead, userId, role])).v

beforeAll(async () => {
  db = await createAwlDb("0628")
}, 120_000) // PGlite starts and the eight migrations apply here: slow on a loaded laptop, and bun's default hook limit is 5 s
afterAll(async () => {
  await db.close()
})

describe("the SQL project-read rule equals canReadProject", () => {
  test("the matrix has 11 roles, and every one of them agrees", async () => {
    expect(ALL_ROLES.length).toBe(11)
    let compared = 0
    for (const role of ALL_ROLES) {
      for (const access of ACCESS) {
        for (const isLead of [true, false]) {
          const user = asUser("u-1", role)
          const project = asProject(access, isLead ? "u-1" : "u-other")
          expect(await sqlCanRead(access, isLead ? "u-1" : "u-other", "u-1", role)).toBe(canReadProject(project, user))
          compared++
        }
      }
    }
    expect(compared).toBe(44)
  })

  test("the readable cases are the documented ones: public for all, private for admins and the lead only", async () => {
    for (const role of ALL_ROLES) {
      const admin = ROLE_RANK[role] >= ROLE_RANK.admin
      expect(await sqlCanRead("public", "u-other", "u-1", role)).toBe(true)
      expect(await sqlCanRead("private", "u-other", "u-1", role)).toBe(admin)
      expect(await sqlCanRead("private", "u-1", "u-1", role)).toBe(true)
    }
  })

  test("no person at all: public is readable, private is not (TS: dbUser null)", async () => {
    expect(await sqlCanRead("public", "u-lead", null, null)).toBe(canReadProject(asProject("public", "u-lead"), null))
    expect(await sqlCanRead("private", "u-lead", null, null)).toBe(canReadProject(asProject("private", "u-lead"), null))
    expect(await sqlCanRead("private", "u-lead", null, null)).toBe(false)
  })

  test("an unknown role has rank 0: never an admin, but the lead of a private project still reads it", async () => {
    const user = asUser("u-1", "not_a_role")
    expect(await sqlCanRead("private", "u-other", "u-1", "not_a_role")).toBe(canReadProject(asProject("private", "u-other"), user))
    expect(await sqlCanRead("private", "u-1", "u-1", "not_a_role")).toBe(canReadProject(asProject("private", "u-1"), user))
  })

  test("a private project with no lead is never readable by a non-admin (it never falls open)", async () => {
    for (const role of ALL_ROLES) {
      const admin = ROLE_RANK[role] >= ROLE_RANK.admin
      expect(await sqlCanRead("private", null, "u-1", role)).toBe(canReadProject(asProject("private", null), asUser("u-1", role)))
      expect(await sqlCanRead("private", null, "u-1", role)).toBe(admin)
    }
  })

  test("an access level that is not 'private' (null or unknown) is treated as public, like the TS", async () => {
    for (const access of [null, "", "internal"]) {
      expect(await sqlCanRead(access, "u-other", "u-1", "viewer")).toBe(canReadProject(asProject(access, "u-other"), asUser("u-1", "viewer")))
      expect(await sqlCanRead(access, "u-other", "u-1", "viewer")).toBe(true)
    }
  })

  test("the rank table equals ROLE_RANK for every role, and an unknown or null role is 0", async () => {
    for (const role of ALL_ROLES) {
      expect((await one<{ r: number }>(db, "select public.ai_work_link__role_rank($1) r", [role])).r).toBe(ROLE_RANK[role])
    }
    expect((await one<{ r: number }>(db, "select public.ai_work_link__role_rank('nope') r")).r).toBe(0)
    expect((await one<{ r: number }>(db, "select public.ai_work_link__role_rank(null) r")).r).toBe(0)
  })
})

describe("the two functions that use the rule agree with it, end to end", () => {
  test("minting succeeds exactly when canReadProject is true, and a live link follows the rule when the project turns private", async () => {
    let minted = 0
    let refused = 0
    let n = 0
    // projects.lead_user_id is a real foreign key, so "someone else" is a real user of the organisation
    await db.query("insert into compliance.users (id, name, email, password_hash, role, is_active, org_id) values ('someone-else', 'Someone', 'someone@example.test', 'x', 'member', true, 'org-p')")
    for (const role of ALL_ROLES) {
      for (const access of ACCESS) {
        for (const isLead of [true, false]) {
          n++
          const uid = `pu-${n}`
          const pid = `pp-${n}`
          await db.query(
            "insert into compliance.users (id, name, email, password_hash, role, is_active, org_id) values ($1, $2, $3, 'x', $4::compliance.user_role, true, 'org-p')",
            [uid, `P ${n}`, `p${n}@example.test`, role],
          )
          await db.query(
            "insert into compliance.projects (id, product_id, org_id, name, access_level, lead_user_id) values ($1, 'prod', 'org-p', $2, $3::compliance.pms_project_access, $4)",
            [pid, `Proj ${n}`, access, isLead ? uid : "someone-else"],
          )
          const readable = canReadProject(asProject(access, isLead ? uid : "someone-else"), asUser(uid, role))

          const mint = await failure(db, "select public.ai_work_link_create_for($1, $2, 0, null, 7, true, null)", [uid, pid])
          if (readable) {
            expect(mint.message).toBe("")
            minted++
          } else {
            expect(mint.message).toBe("PROJECT_NOT_READABLE")
            expect(mint.code).toBe("AW403")
            refused++
            continue
          }

          // the link exists: turn the project private with nobody as lead, and the link must follow the same rule for the same person
          const token = (await one<{ t: string }>(db, "select (public.ai_work_link_create_for($1, $2, 0, null, 7, true, null)) ->> 'token' t", [uid, pid])).t
          await db.query("update compliance.projects set access_level = 'private', lead_user_id = null where id = $1", [pid])
          const after = (await one<{ s: string }>(db, "select public.ai_work_link__resolve($1) ->> 'status' s", [token])).s
          expect(after === "ok").toBe(canReadProject(asProject("private", null), asUser(uid, role)))
        }
      }
    }
    // both outcomes really occurred: this is not a matrix of one kind of answer. Refused = a private project, not the lead, and one of
    // the 9 roles below admin; everything else of the 44 combinations mints.
    expect(refused).toBe(9)
    expect(minted).toBe(35)
  })
})
