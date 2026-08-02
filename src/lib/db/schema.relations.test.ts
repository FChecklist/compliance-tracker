/// <reference types="bun-types" />
// UMR-20260802-165606-4413 (amends parent UMR-20260802-104058-25ba): real
// root cause of the Compliance Register / Pendency View crash certified on
// projexa-ai.com for a fresh self-signup org. `GET /api/departments` calls
// `db.query.departments.findMany({ with: { head, complianceItems, users } })`
// (src/app/api/departments/route.ts). `departments` and `users` have two
// distinct FK relation pairs to each other -- `head`/`headOfDept` (via
// `departments.headId`) and the department-membership pair (via
// `users.departmentId`) -- and only the `head`/`headOfDept` pair had an
// explicit `relationName`. Drizzle's relational query builder requires
// EVERY relation pair between two tables to be named once more than one
// pair exists, not just the ones an author thinks are ambiguous -- leaving
// the membership pair unnamed made `with: { users: ... }` throw at
// query-build time: "There are multiple relations between 'users' and
// 'departments'. Please specify relation name".
//
// This is a pure schema-config check, independent of org data, RLS, or
// tenant context -- confirmed by direct reproduction against the real
// database with RLS enforced (SET ROLE app_runtime), for both the real
// fresh self-signup org from
// ai-os/PROJEXA_AI_COM_E2E_CERTIFICATION_REDO_2026-08-02.md and an older
// seeded org: both failed identically before this fix and both succeeded
// identically after it. Drizzle throws this error while building the SQL,
// before any network I/O is attempted (verified: the error fires in ~2ms
// against a deliberately unroutable host/port, well before postgres.js's
// own connect_timeout could even elapse) -- so this test can assert the
// real failure mode without touching a live DB, matching this repo's
// established convention (see settings/branding/route.test.ts) of never
// hitting a live DB from a .test.ts file. The bogus connection below is
// never actually dialed for this assertion.
import { describe, test, expect } from "bun:test"
import { drizzle } from "drizzle-orm/postgres-js"
import { asc } from "drizzle-orm"
import postgres from "postgres"
import * as schema from "./schema"

describe("departments <-> users relation config", () => {
  test("db.query.departments.findMany({ with: { head, complianceItems, users } }) does not throw a relation-ambiguity error", async () => {
    // Deliberately unroutable -- this must never actually connect. If this
    // test starts hanging or timing out on a real connection attempt
    // instead of resolving/rejecting near-instantly, that's a sign the
    // relation-ambiguity check stopped happening at build time and this
    // test needs to be revisited, not just given a longer timeout.
    const client = postgres("postgresql://nouser:nopass@127.0.0.1:1/nodb", {
      prepare: false,
      max: 1,
      connect_timeout: 1,
    })
    const db = drizzle(client, { schema })

    let caught: unknown = null
    try {
      await db.query.departments.findMany({
        with: {
          head: { columns: { name: true } },
          complianceItems: { columns: { id: true, status: true } },
          users: { columns: { id: true } },
        },
        orderBy: asc(schema.departments.name),
      })
    } catch (err) {
      caught = err
    } finally {
      await client.end({ timeout: 1 })
    }

    // A real connection-refused/timeout error is expected and fine (proves
    // the ambiguity check passed and drizzle moved on to actually dialing
    // the unroutable host). What must never come back is the relation
    // ambiguity error.
    const message = caught instanceof Error ? caught.message : String(caught)
    expect(message).not.toContain("multiple relations")
    expect(message).not.toContain("specify relation name")
  })
})
