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
// identically after it.
//
// The actual check runs in `schema-relations-check.mjs`, in its own child
// process (spawned below) rather than inline in this test file. Reason:
// this repo's full `bun test` run shares one process across 200+
// `*.test.ts` files, and this is the only one that constructs a real, live
// `drizzle(client, { schema })` relational query builder over the FULL
// schema -- every other route test mocks `withTenantContext`/`@/lib/db`
// itself and never reaches this code path. That made it uniquely exposed
// to an earlier test file's `mock.module("@/lib/db", ...)` (or a schema
// sub-path) left unrestored for the rest of the run, which was observed in
// CI to corrupt an unrelated relation's config (`apiKeyRequestLog`) when
// this check ran inline as part of the full suite, even though it passed
// in isolation. Running out-of-process gets a guaranteed-fresh module
// registry every time, matching how this code actually runs in production
// (a fresh process, never a shared test registry) -- so this is the more
// faithful check, not a workaround around a real product bug.
import { describe, test, expect } from "bun:test"
import path from "node:path"

describe("departments <-> users relation config", () => {
  test("db.query.departments.findMany({ with: { head, complianceItems, users } }) does not throw a relation-ambiguity error", async () => {
    const scriptPath = path.join(import.meta.dir, "schema-relations-check.mjs")
    const proc = Bun.spawn(["bun", "run", scriptPath], {
      stdout: "pipe",
      stderr: "pipe",
      cwd: path.join(import.meta.dir, "..", "..", ".."),
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    expect(exitCode).toBe(0)
    // If the check process crashed instead of producing its JSON summary,
    // stderr will explain why -- surface it in the failure rather than
    // failing an opaque JSON.parse.
    const { message } = (() => {
      try {
        return JSON.parse(stdout)
      } catch {
        throw new Error(`schema-relations-check.mjs produced no valid JSON. stderr:\n${stderr}\nstdout:\n${stdout}`)
      }
    })()

    // A real connection-refused/timeout error is expected and fine (proves
    // the ambiguity check passed and drizzle moved on to actually dialing
    // the unroutable host). What must never come back is the relation
    // ambiguity error.
    expect(message).not.toContain("multiple relations")
    expect(message).not.toContain("specify relation name")
  })
})
