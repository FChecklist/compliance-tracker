// fix/signup-first-user-link: the first user of a platform-provisioned org is created once, only for an org with no
// user, only for a platform-issued key, and idempotently. The service takes its database operations as deps, so the
// test drives the real decision logic against an in-memory org table with the same UNIQUE(email) rule as the real one.
import { describe, test, expect, beforeEach } from "bun:test"
import { ensureFirstPlatformUser, resetFirstUserMemo, type FirstUserDeps } from "./platform-first-user-service"
import { USER_NOT_LINKED_MESSAGE } from "@/lib/supabase/auth-guard"

const SUB = "3f2b8c1e-5a47-4d0e-9b1a-0c2d4e6f8a10"

type Row = { id: string; name: string; email: string; orgId: string; departmentId: string | null; authUserId: string | null }

function fakeDb(seed: Row[] = []) {
  const rows: Row[] = [...seed]
  let inserts = 0
  let afterCreated = 0
  const deps: FirstUserDeps = {
    orgHasUsers: async (orgId) => rows.some((r) => r.orgId === orgId),
    defaultDepartmentId: async () => "dept-general",
    insertUser: async (row) => {
      inserts++
      if (rows.some((r) => r.email === row.email)) return null // UNIQUE(email)
      const id = `u${rows.length + 1}`
      rows.push({ id, ...row })
      return id
    },
    afterCreate: async () => {
      afterCreated++
    },
  }
  return { rows, deps, stats: () => ({ inserts, afterCreated }) }
}

const input = { orgId: "org-1", issuedForApplicationId: "app-projexa", actorEmail: "Sumeetds@Gmail.com", actorId: SUB }

beforeEach(() => resetFirstUserMemo())

describe("ensureFirstPlatformUser", () => {
  test("creates the first user once, as admin-linked to the PROJEXA session id, and a second call adds nothing", async () => {
    const { rows, deps, stats } = fakeDb()
    expect(await ensureFirstPlatformUser(input, deps)).toBe("created")
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ email: "sumeetds@gmail.com", orgId: "org-1", departmentId: "dept-general", authUserId: SUB, name: "sumeetds" })
    expect(stats().afterCreated).toBe(1)
    expect(await ensureFirstPlatformUser(input, deps)).toBe("org_has_users")
    resetFirstUserMemo() // even with a cold memo the org's own user stops a second creation
    expect(await ensureFirstPlatformUser(input, deps)).toBe("org_has_users")
    expect(rows).toHaveLength(1)
    expect(stats().inserts).toBe(1)
  })

  test("never fires for an org that already has a user, whoever asks (no second person, no escalation)", async () => {
    const { rows, deps } = fakeDb([{ id: "u0", name: "Existing", email: "owner@x.com", orgId: "org-1", departmentId: null, authUserId: null }])
    expect(await ensureFirstPlatformUser({ ...input, actorEmail: "mallory@evil.com" }, deps)).toBe("org_has_users")
    expect(rows).toHaveLength(1)
  })

  test("a key that was not issued for a platform application never creates a user", async () => {
    const { rows, deps, stats } = fakeDb()
    expect(await ensureFirstPlatformUser({ ...input, issuedForApplicationId: null }, deps)).toBe("skipped")
    expect(await ensureFirstPlatformUser({ ...input, issuedForApplicationId: undefined }, deps)).toBe("skipped")
    expect(rows).toHaveLength(0)
    expect(stats().inserts).toBe(0)
  })

  test("needs an org and an email-shaped acting email", async () => {
    const { rows, deps } = fakeDb()
    expect(await ensureFirstPlatformUser({ ...input, orgId: null }, deps)).toBe("skipped")
    expect(await ensureFirstPlatformUser({ ...input, actorEmail: "not-an-email" }, deps)).toBe("skipped")
    expect(await ensureFirstPlatformUser({ ...input, actorEmail: null }, deps)).toBe("skipped")
    expect(rows).toHaveLength(0)
  })

  test("parallel calls (a dashboard firing several requests) create exactly one user", async () => {
    const { rows, deps, stats } = fakeDb()
    const out = await Promise.all([ensureFirstPlatformUser(input, deps), ensureFirstPlatformUser(input, deps), ensureFirstPlatformUser(input, deps)])
    expect(out).toEqual(["created", "created", "created"]) // they share the one in-flight attempt
    expect(rows).toHaveLength(1)
    expect(stats().inserts).toBe(1)
  })

  test("idempotent on an email conflict: nothing is written and the loser reports it", async () => {
    // the email already belongs to a user of ANOTHER org (users.email is globally unique)
    const { rows, deps } = fakeDb([{ id: "u0", name: "Other", email: "sumeetds@gmail.com", orgId: "org-2", departmentId: null, authUserId: null }])
    expect(await ensureFirstPlatformUser(input, deps)).toBe("email_taken")
    expect(rows).toHaveLength(1)
    expect(rows[0].orgId).toBe("org-2")
  })

  test("a non-UUID acting id is not stored as auth_user_id", async () => {
    const { rows, deps } = fakeDb()
    await ensureFirstPlatformUser({ ...input, actorId: "user-123" }, deps)
    expect(rows[0].authUserId).toBeNull()
  })

  test("a database failure never throws: the request proceeds as before", async () => {
    const { deps } = fakeDb()
    const boom: FirstUserDeps = { ...deps, orgHasUsers: async () => { throw new Error("pool timeout") } }
    expect(await ensureFirstPlatformUser(input, boom)).toBe("skipped")
  })
})

describe("the not-linked sentence", () => {
  test("names PROJEXA, not VERIDIAN", () => {
    expect(USER_NOT_LINKED_MESSAGE).toBe("Your PROJEXA account is not linked to a PROJEXA user - ask your admin")
  })
})
