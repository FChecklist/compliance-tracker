/// <reference types="bun-types" />
// Stage 12 (VERIDIAN_CONSOLIDATED_COMPLETION plan) verification -- mocked
// dispatch records only, @/lib/db is mock.module()'d here, matching
// roster-overrides.test.ts's own established pattern for this kind of
// dependency (never touching a live DB from a .test.ts file). No test in
// this file makes, or could make, any real call to OpenRouter/Groq/
// Cerebras/any AI provider -- everything exercised here is pure DB-write/
// DB-read logic against a fully mocked drizzle client.
import { describe, expect, test, mock, afterEach } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
// bun:test's mock.module() replaces a module specifier process-wide, not
// per-file -- when `bun test` runs the whole repo, whichever test file's
// mock.module("@/lib/db", ...) factory is active last wins for every OTHER
// file's dynamic imports too (confirmed empirically: running this file
// alongside roster-overrides.test.ts broke ITS `aiTeamRoleOverrides` import
// with "Export named 'aiTeamRoleOverrides' not found", regardless of file
// order). Spreading the REAL schema module here (pure drizzle table
// metadata, zero DB connection at import time -- db/index.ts's connection
// is lazy, per its own header) means every real named export
// (aiTeamRoleOverrides, dispatchOutcomes, everything else) stays present no
// matter which file's mock is currently active, so this file can't clobber
// a sibling test file's own "@/lib/db" mock.
import * as realSchema from "@/lib/db/schema"

type FakeRow = {
  id: string
  roleKey: string
  dispatchPath: string
  objective: string
  scope: string | null
  successCriteria: string | null
  complexityTier: string | null
  requestFingerprint: string
  status: string
  prUrl: string | null
  errorDetail: string | null
  modelUsed: string | null
  orgId: string | null
  dispatchedBy: string | null
  dispatchedAt: Date
  completedAt: Date | null
  createdAt: Date
}

/**
 * Mocks @/lib/db with an in-memory fake dispatch_outcomes table so
 * recordDispatchOutcome()/checkForDuplicateDispatch() can be exercised
 * without a live Postgres connection. `seed` pre-populates rows (the
 * "prior dispatch" fixtures); `insertSpy` captures every insert().values()
 * call for assertion; `findFirstImpl` lets a test override the lookup
 * behavior (e.g. to simulate a DB error for the fail-open test).
 */
function mockDb(options: {
  seed?: FakeRow[]
  findFirstImpl?: (args: unknown) => Promise<FakeRow | undefined>
  insertImpl?: (values: unknown) => Promise<void>
}) {
  const seed = options.seed ?? []
  const insertSpy = mock(async (values: unknown) => {
    if (options.insertImpl) return options.insertImpl(values)
    return undefined
  })
  const findFirst =
    options.findFirstImpl ??
    (async () => {
      // Real behavior being mimicked: ORDER BY dispatched_at DESC LIMIT 1 --
      // the mock sorts the seed the same way so tests can seed out of order.
      const sorted = [...seed].sort((a, b) => b.dispatchedAt.getTime() - a.dispatchedAt.getTime())
      return sorted[0]
    })

  mock.module("@/lib/db", () => ({
    ...realSchema,
    db: {
      insert: mock(() => ({
        values: insertSpy,
      })),
      query: {
        dispatchOutcomes: {
          findFirst: mock(findFirst),
        },
      },
    },
  }))

  return { insertSpy }
}

afterEach(() => {
  mock.restore()
})

describe("fingerprintDispatchRequest", () => {
  test("same role/objective/scope produces the same fingerprint regardless of case/whitespace", async () => {
    mockDb({})
    const { fingerprintDispatchRequest } = await import("./dispatch-outcomes")
    const a = fingerprintDispatchRequest({
      roleKey: "backend_engineer",
      objective: "  Add   a   rate limiter   to /api/checkout  ",
      scope: "src/app/api/checkout",
    })
    const b = fingerprintDispatchRequest({
      roleKey: "backend_engineer",
      objective: "add a rate limiter to /api/checkout",
      scope: "SRC/APP/API/CHECKOUT",
    })
    expect(a).toBe(b)
  })

  test("a genuinely different objective produces a different fingerprint", async () => {
    mockDb({})
    const { fingerprintDispatchRequest } = await import("./dispatch-outcomes")
    const a = fingerprintDispatchRequest({ roleKey: "backend_engineer", objective: "Add a rate limiter to /api/checkout" })
    const b = fingerprintDispatchRequest({ roleKey: "backend_engineer", objective: "Add pagination to /api/invoices" })
    expect(a).not.toBe(b)
  })

  test("the same objective dispatched to a different role produces a different fingerprint", async () => {
    mockDb({})
    const { fingerprintDispatchRequest } = await import("./dispatch-outcomes")
    const a = fingerprintDispatchRequest({ roleKey: "backend_engineer", objective: "Write the Q3 board summary" })
    const b = fingerprintDispatchRequest({ roleKey: "finance_analyst", objective: "Write the Q3 board summary" })
    expect(a).not.toBe(b)
  })
})

describe("recordDispatchOutcome", () => {
  test("a successful simulated dispatch completion persists with the real fields", async () => {
    const { insertSpy } = mockDb({})
    const { recordDispatchOutcome, fingerprintDispatchRequest } = await import("./dispatch-outcomes")

    await recordDispatchOutcome({
      roleKey: "backend_engineer",
      objective: "Add a rate limiter to /api/checkout",
      scope: "src/app/api/checkout",
      successCriteria: "429 after 10 req/min per IP",
      complexityTier: "moderate",
      dispatchPath: "advisory",
      status: "success",
      modelUsed: "z-ai/glm-5.2",
      orgId: null,
      dispatchedBy: "user_veridian_admin_1",
    })

    expect(insertSpy).toHaveBeenCalledTimes(1)
    const written = insertSpy.mock.calls[0][0] as Record<string, unknown>
    expect(written.roleKey).toBe("backend_engineer")
    expect(written.dispatchPath).toBe("advisory")
    expect(written.status).toBe("success")
    expect(written.modelUsed).toBe("z-ai/glm-5.2")
    expect(written.orgId).toBeNull()
    expect(written.dispatchedBy).toBe("user_veridian_admin_1")
    expect(written.requestFingerprint).toBe(
      fingerprintDispatchRequest({
        roleKey: "backend_engineer",
        objective: "Add a rate limiter to /api/checkout",
        scope: "src/app/api/checkout",
      })
    )
  })

  test("a failed simulated dispatch completion persists status='failure' with the real error detail", async () => {
    const { insertSpy } = mockDb({})
    const { recordDispatchOutcome } = await import("./dispatch-outcomes")

    await recordDispatchOutcome({
      roleKey: "backend_engineer",
      objective: "Add a rate limiter to /api/checkout",
      dispatchPath: "repo_write",
      status: "failure",
      errorDetail: "GITHUB_DISPATCH_PAT is not configured -- cannot fire repository_dispatch from the app.",
    })

    expect(insertSpy).toHaveBeenCalledTimes(1)
    const written = insertSpy.mock.calls[0][0] as Record<string, unknown>
    expect(written.status).toBe("failure")
    expect(written.dispatchPath).toBe("repo_write")
    expect(written.errorDetail).toBe(
      "GITHUB_DISPATCH_PAT is not configured -- cannot fire repository_dispatch from the app."
    )
    expect(written.prUrl).toBeNull()
  })

  test("never throws -- a persistence failure is swallowed, not surfaced to the caller", async () => {
    mockDb({
      insertImpl: async () => {
        throw new Error("simulated transient DB outage")
      },
    })
    const { recordDispatchOutcome } = await import("./dispatch-outcomes")

    // Must resolve, not reject -- a dispatch that already happened must
    // never be reported as failed just because the OUTCOME WRITE failed.
    await expect(
      recordDispatchOutcome({
        roleKey: "backend_engineer",
        objective: "Add a rate limiter to /api/checkout",
        dispatchPath: "advisory",
        status: "success",
      })
    ).resolves.toBeUndefined()
  })
})

describe("checkForDuplicateDispatch", () => {
  test("flags a deliberately-duplicated request (identical role/objective/scope as a prior dispatch)", async () => {
    const priorDispatchedAt = new Date("2026-07-28T10:00:00Z")
    mockDb({
      seed: [
        {
          id: "row_1",
          roleKey: "backend_engineer",
          dispatchPath: "repo_write",
          objective: "Add a rate limiter to /api/checkout",
          scope: "src/app/api/checkout",
          successCriteria: null,
          complexityTier: "moderate",
          requestFingerprint: "irrelevant-precomputed-in-mock",
          status: "success",
          prUrl: "https://github.com/FChecklist/compliance-tracker/pull/999",
          errorDetail: null,
          modelUsed: "z-ai/glm-5.2",
          orgId: null,
          dispatchedBy: "user_veridian_admin_1",
          dispatchedAt: priorDispatchedAt,
          completedAt: priorDispatchedAt,
          createdAt: priorDispatchedAt,
        },
      ],
    })
    const { checkForDuplicateDispatch } = await import("./dispatch-outcomes")

    // Deliberately reworded (extra whitespace, different case) but the SAME
    // real request -- exercises the normalization, not just a literal
    // string match.
    const result = await checkForDuplicateDispatch({
      roleKey: "backend_engineer",
      objective: "  add a rate limiter to /api/checkout  ",
      scope: "SRC/app/API/checkout",
    })

    expect(result.isDuplicate).toBe(true)
    if (result.isDuplicate) {
      expect(result.priorOutcome.id).toBe("row_1")
      expect(result.priorOutcome.status).toBe("success")
      expect(result.priorOutcome.prUrl).toBe("https://github.com/FChecklist/compliance-tracker/pull/999")
      expect(result.message).toContain("already dispatched")
      expect(result.message).toContain("pull/999")
    }
  })

  test("passes a genuinely different request through with no warning", async () => {
    const priorDispatchedAt = new Date("2026-07-28T10:00:00Z")
    mockDb({
      seed: [
        {
          id: "row_1",
          roleKey: "backend_engineer",
          dispatchPath: "repo_write",
          objective: "Add a rate limiter to /api/checkout",
          scope: "src/app/api/checkout",
          successCriteria: null,
          complexityTier: "moderate",
          requestFingerprint: "irrelevant-precomputed-in-mock",
          status: "success",
          prUrl: "https://github.com/FChecklist/compliance-tracker/pull/999",
          errorDetail: null,
          modelUsed: "z-ai/glm-5.2",
          orgId: null,
          dispatchedBy: "user_veridian_admin_1",
          dispatchedAt: priorDispatchedAt,
          completedAt: priorDispatchedAt,
          createdAt: priorDispatchedAt,
        },
      ],
      // The mock's default findFirst matches by construction (it always
      // returns the seed regardless of the queried fingerprint, since the
      // real WHERE clause lives in Postgres, not in this test double) --
      // so this test asserts the real fingerprint DIFFERS instead, which
      // is what makes the real (unmocked) SQL WHERE eq(requestFingerprint,
      // ...) return no row for a genuinely different request.
      findFirstImpl: async () => undefined,
    })
    const { checkForDuplicateDispatch } = await import("./dispatch-outcomes")

    const result = await checkForDuplicateDispatch({
      roleKey: "backend_engineer",
      objective: "Add pagination to the invoices list endpoint",
      scope: "src/app/api/invoices",
    })

    expect(result.isDuplicate).toBe(false)
  })

  test("fails open (no warning) if the duplicate-check lookup itself errors", async () => {
    mockDb({
      findFirstImpl: async () => {
        throw new Error("simulated transient DB outage")
      },
    })
    const { checkForDuplicateDispatch } = await import("./dispatch-outcomes")

    const result = await checkForDuplicateDispatch({
      roleKey: "backend_engineer",
      objective: "Add a rate limiter to /api/checkout",
    })

    expect(result.isDuplicate).toBe(false)
  })
})

describe("drizzle/0300_stage12_dispatch_outcomes.sql (static RLS review)", () => {
  // Real Stage 9-style RLS verification without a live DB apply: this repo's
  // own convention (0173/0165's migration headers) is that a human
  // orchestrator applies a migration to the live database after PR review
  // -- so this migration is intentionally NOT applied to the live Supabase
  // project by this change. What CAN be verified right now, statically and
  // deterministically, is that the migration file itself declares the
  // fail-closed posture this task requires: RLS enabled, exactly the
  // service_role bypass policy (mirroring platform.task_capabilities' own
  // live, already-verified policy set -- confirmed via a direct
  // pg_policies/information_schema query against the real Supabase project
  // during this task's design phase), and no app_runtime/anon/authenticated
  // policy that would leave the table readable/writable outside server-side
  // code.
  const migrationPath = join(import.meta.dir, "../../../drizzle/0300_stage12_dispatch_outcomes.sql")
  const sql = readFileSync(migrationPath, "utf8")

  test("enables RLS on platform.dispatch_outcomes", () => {
    expect(sql).toContain("ALTER TABLE platform.dispatch_outcomes ENABLE ROW LEVEL SECURITY")
  })

  test("defines exactly one policy, scoped to service_role only (fail-closed for every other role)", () => {
    const policyMatches = [...sql.matchAll(/CREATE POLICY\s+(\S+)\s+ON\s+platform\.dispatch_outcomes\s+FOR\s+(\w+)\s+TO\s+(\w+)/g)]
    expect(policyMatches.length).toBe(1)
    const [, name, cmd, role] = policyMatches[0]
    expect(name).toBe("service_role_bypass_dispatch_outcomes")
    expect(cmd).toBe("ALL")
    expect(role).toBe("service_role")
  })

  test("does not grant anon/authenticated/app_runtime a policy on this table", () => {
    expect(sql).not.toMatch(/CREATE POLICY[\s\S]*?TO\s+(anon|authenticated)/i)
    // app_runtime gets a table-level GRANT (consistency with sibling tables)
    // but no RLS POLICY -- assert the policy-only text has no app_runtime
    // policy definition (as opposed to the separate GRANT statement, which
    // is expected and fine).
    const policyBlock = sql.slice(sql.indexOf("CREATE POLICY") - 50)
    expect(policyBlock).not.toMatch(/CREATE POLICY[\s\S]*TO\s+app_runtime/)
  })
})
