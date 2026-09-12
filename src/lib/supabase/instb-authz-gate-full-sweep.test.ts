/// <reference types="bun-types" />
// INST-B / DOD-C7 (D56): both-direction authz-gate test over EVERY route
// this repo's own src/app/api/** tree declares a requireRole/
// requireRoleOrScope guard for -- not a fixed historical list. Generalizes
// the exact mechanism src/lib/supabase/authz-gate-coverage.test.ts already
// proved correct for its original 189-route R75 Phase 2 slice: import the
// REAL route module, call its REAL exported handler directly (no live HTTP
// server, no live DB -- withTenantContext is mocked to fail fast, same as
// that file, since this test exercises the role gate only, not full
// business-logic success), with a synthetic below-minimum and at-minimum
// caller.
//
// PIPELINE (filesystem/router-derived, not hand-written, per D56):
//   scripts/enumerate-api-routes.mjs  -> kt-instb/route-enumeration.json
//     (every route.ts, every exported method, the guard call found in it)
//   scripts/generate-authz-gate-table.mjs -> kt-instb/authz-gate-table.json
//     (guarded rows only, grouped by specifier+guard+role)
//   this file -> runs the same test authz-gate-coverage.test.ts proved
//     against every group in that table.
//
// Run `node scripts/enumerate-api-routes.mjs && node
// scripts/generate-authz-gate-table.mjs` before this test if the route tree
// has changed since the table was last generated -- this file reads the
// committed JSON snapshot rather than regenerating it on every run, so a
// stale snapshot is a known, visible risk (the file's own generated_at
// field, printed in this suite's own summary log, makes staleness
// checkable), not a silent one.
//
// FALSIFIABILITY PROOF (required before this instrument's results count as
// evidence, per D56's own instruction: "an unfalsified instrument is worth
// nothing here"): see scripts/instb-falsifiability-proof.mjs, which plants
// a synthetic route with a deliberately-broken guard, runs it through this
// exact harness, and asserts the harness catches it. That script's own
// output is the falsifiability evidence -- it is NOT run as part of this
// suite (a deliberately-broken fixture must never live in the route tree
// this suite scans), see that script for the full proof.
import { describe, test, expect, mock, beforeEach } from "bun:test"
import { ROLE_RANK, type UserRole } from "@/lib/supabase/role-rank"
import { NextRequest, NextResponse } from "next/server"
import * as RealTenantScoped from "@/lib/db/tenant-scoped"
import fs from "node:fs"
import path from "node:path"

mock.module("@/lib/db/tenant-scoped", () => ({
  ...RealTenantScoped,
  withTenantContext: async () => {
    throw new Error("instb: withTenantContext blocked -- this test only exercises the role gate, never real business logic/DB access")
  },
}))

type FixtureUser = { id: string; role: UserRole; orgId: string; name: string; email: string }
let currentUser: FixtureUser | null = null
const GATE_MESSAGE = (minimumRole: UserRole) => `This action requires ${minimumRole} role or higher`

function fakeRequireRole(dbUser: FixtureUser | null, minimumRole: UserRole) {
  const rank = dbUser ? (ROLE_RANK[dbUser.role] ?? 0) : 0
  if (rank < ROLE_RANK[minimumRole]) return NextResponse.json({ error: GATE_MESSAGE(minimumRole) }, { status: 403 })
  return null
}
function fakeRequireRoleOrScope(ctx: { dbUser?: FixtureUser | null; apiKey?: unknown }, minimumRole: UserRole) {
  if (ctx?.dbUser) return fakeRequireRole(ctx.dbUser, minimumRole)
  if (ctx?.apiKey) return null
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
}
function fakeHasRole(dbUser: FixtureUser | null, minimumRole: UserRole): boolean {
  const rank = dbUser ? (ROLE_RANK[dbUser.role] ?? 0) : 0
  return rank >= ROLE_RANK[minimumRole]
}
function fakeRequireOrg(ctx: { orgId: string | null }, message = "No organisation on this account") {
  if (ctx.orgId) return null
  return NextResponse.json({ error: message }, { status: 400 })
}

// D-05 acting-user helpers: added after the first sweep run hit 9 import
// failures ("Export named 'readActingUserId'/'resolveActingUser' not found")
// -- mock.module() replaces a module's ENTIRE export set, so any real export
// a route imports but this mock doesn't re-provide breaks that route's
// import with a hard error, unrelated to the role gate itself (same
// documented risk authz-gate-coverage.test.ts's own header already
// describes for hasRole/requireOrg). readActingUserId is pure (header read),
// safe verbatim. resolveActingUser's real implementation can touch the DB
// on its actorId/actorEmail branches, but every route using it calls its
// own requireRole/requireRoleOrScope check FIRST (confirmed by reading
// src/app/api/v1/projexa/timesheets/route.ts directly -- requireRoleOrScope
// on line 125, resolveActingUser only reached after, on line 141) --
// so in this sweep's below-minimum case the gate always returns before
// resolveActingUser is ever called, and only its ctx.dbUser-present branch
// (no DB) is reachable in the at-minimum case with a synthetic request that
// carries no X-Acting-User header.
function fakeReadActingUserId(_request: { headers: Headers }): string | null {
  return null // no synthetic request in this sweep sets the acting-user header
}
async function fakeResolveActingUser(ctx: { dbUser?: FixtureUser | null; apiKey?: unknown }) {
  if (ctx?.dbUser) return { user: ctx.dbUser, error: null }
  return { user: null, error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
}

beforeEach(() => {
  currentUser = null
  mock.module("@/lib/supabase/auth-guard", () => ({
    ROLE_RANK,
    requireAuth: mock(async () => ({ response: null, dbUser: currentUser, orgId: "instb-test-org", user: currentUser ? { id: currentUser.id } : null })),
    requireAuthOrApiKey: mock(async () => ({ response: null, dbUser: currentUser, orgId: "instb-test-org", apiKey: null })),
    requireRole: fakeRequireRole,
    requireRoleOrScope: fakeRequireRoleOrScope,
    hasRole: fakeHasRole,
    requireOrg: fakeRequireOrg,
    readActingUserId: fakeReadActingUserId,
    readActingUserEmail: () => null,
    resolveActingUser: fakeResolveActingUser,
  }))
})

function fakeParams(): Promise<Record<string, string>> {
  return Promise.resolve(new Proxy({}, { get: () => "instb-test-id" }) as Record<string, string>)
}
function fakeRequest(method: string): NextRequest {
  // CAUGHT BY THE HARNESS'S OWN OUTPUT: the first run of the full sweep hit
  // 3 real test failures (not the target route's fault) tracing to a plain
  // Request lacking `.nextUrl` -- a Next.js-specific NextRequest property a
  // handful of real routes read BEFORE their role gate runs (e.g.
  // request.nextUrl.searchParams for a query flag). The original 189-route
  // authz-gate-coverage.test.ts's own plain-Request fakeRequest() never hit
  // this because none of its 189 routes happened to read nextUrl first --
  // it was a gap in that fixture too, just never exercised. Using the real
  // NextRequest class (which extends Request and adds nextUrl) fixes it for
  // every route, not just the 3 caught this pass.
  const init: RequestInit = { method, headers: { "content-type": "application/json" } }
  if (method !== "DELETE" && method !== "GET") init.body = "{}"
  return new NextRequest("http://localhost/instb-authz-test", init)
}

const tablePath = path.join(import.meta.dir, "..", "..", "..", "kt-instb", "authz-gate-table.json")
type TableEntry = { specifier: string; guard: "requireRole" | "requireRoleOrScope"; role: UserRole; methods: string[] }
const TABLE: TableEntry[] = fs.existsSync(tablePath) ? JSON.parse(fs.readFileSync(tablePath, "utf8")) : []

if (TABLE.length === 0) {
  console.warn("instb-authz-gate-full-sweep: kt-instb/authz-gate-table.json missing or empty -- run enumerate-api-routes.mjs + generate-authz-gate-table.mjs first. 0 groups to test.")
}

// D56 disclosure, not silent suppression, for two real limitations the
// first full run surfaced:
//
// 1. FLOOR ROLES (ROLE_RANK 1: viewer/client_viewer/external_auditor/
//    stage_0): a "below-minimum" caller cannot exist for a route whose own
//    declared minimum IS the floor -- there is no rank below 1. The first
//    run's synthetic below-minimum probe (itself a "viewer") was therefore
//    actually AT the minimum for these routes, passed the gate, reached the
//    mocked withTenantContext, and threw -- 4 apparent "failures" that were
//    a test-design gap, not an authz problem. Skipped below-minimum for
//    these, counted and reported separately, not silently dropped.
const FLOOR_ROLES: UserRole[] = ["viewer", "client_viewer", "external_auditor", "stage_0"]

// 2. CONDITIONAL GUARDS: a route can call requireRole only inside a
//    branch that depends on the REQUEST BODY (e.g. "self-enroll always
//    allowed, enrolling someone else requires manager+"). This sweep's
//    generic synthetic body ("{}") never triggers that branch, so the gate
//    is never reached for the below-minimum probe and the handler proceeds
//    to real logic instead -- confirmed by reading the source directly for
//    every entry below, not assumed. This is a real, disclosed limitation
//    of a generic-body sweep, not a security finding and not a harness bug:
//    the gate exists and is correctly positioned for the case it protects.
//    A currently-known, non-exhaustive list -- routes with the same
//    self-vs-other conditional-gate SHAPE elsewhere in the tree were not
//    separately re-audited this pass; see the report for that caveat.
const KNOWN_CONDITIONAL_GUARDS = new Set<string>([
  "@/app/api/training/enrollments/route|POST", // requireRole(manager) only fires when body.employeeId !== self
])

// 3. UNRELATED SIBLING-PROMISE REJECTION (test-environment artifact, not an
//    authz finding, not a harness bug): capability-backfill-service.ts's
//    measureCapabilityCoverage() runs 5 independent data reads via
//    Promise.all(). This sweep mocks exactly one of them
//    (withTenantContext) to throw fast; Promise.all rejects on that first
//    failure, but the OTHER 4 promises are NOT cancelled and keep running
//    against real, unmocked dependencies in this test process -- when one
//    of THOSE also eventually rejects (for unrelated reasons: no real DB in
//    this test run), it surfaces as an unhandled rejection bun reports
//    between tests, after the "permits" test's own try/catch has already
//    returned. Root-caused by reading capability-backfill-service.ts:50-62
//    directly. The route's OWN gate (requireRole(dbUser, "admin"),
//    coverage/route.ts:12) is correctly positioned before this code path
//    entirely, so the below-minimum probe for this route is unaffected and
//    still runs and passes -- only the at-minimum ("permits") probe hits
//    this, and only because of how this specific test mocks one of five
//    parallel calls.
const KNOWN_UNRELATED_ASYNC_ARTIFACT = new Set<string>([
  "@/app/api/capability-registry/coverage/route|GET",
])

let passCount = 0
let failCount = 0
const failures: string[] = []
const skippedFloorRole: string[] = []
const skippedConditional: string[] = []

describe(`INST-B/DOD-C7: every guarded route (${TABLE.length} groups, generated from the live tree) rejects below its minimum role and permits at it`, () => {
  for (const entry of TABLE) {
    const isFloor = FLOOR_ROLES.includes(entry.role)
    describe(`${entry.specifier} (${entry.guard} >= ${entry.role})`, () => {
      test(`rejects a role below ${entry.role} with exactly this gate's 403`, async () => {
        if (isFloor) {
          skippedFloorRole.push(`${entry.specifier}: role="${entry.role}" is a floor role (rank 1) -- no valid below-minimum caller exists`)
          return
        }
        currentUser = { id: "instb-low-user", role: "viewer", orgId: "instb-test-org", name: "Low", email: "low@test.invalid" }
        let mod: any
        try {
          mod = await import(entry.specifier)
        } catch (e) {
          failCount++
          failures.push(`${entry.specifier}: import failed -- ${(e as Error).message}`)
          throw e
        }
        for (const method of entry.methods) {
          if (KNOWN_CONDITIONAL_GUARDS.has(`${entry.specifier}|${method}`)) {
            skippedConditional.push(`${entry.specifier} ${method}: known conditional guard, generic body does not trigger it (see KNOWN_CONDITIONAL_GUARDS comment)`)
            continue
          }
          const handler = mod[method]
          expect(typeof handler).toBe("function")
          const res = await handler(fakeRequest(method), { params: fakeParams() })
          if (res.status !== 403) { failCount++; failures.push(`${entry.specifier} ${method}: expected 403 for below-minimum, got ${res.status}`) }
          expect(res.status).toBe(403)
          const body = await res.clone().json().catch(() => ({}))
          if (body?.error !== GATE_MESSAGE(entry.role)) { failCount++; failures.push(`${entry.specifier} ${method}: wrong gate message`) }
          expect(body?.error).toBe(GATE_MESSAGE(entry.role))
          passCount++
        }
      })

      test(`permits a role at ${entry.role} (does not return this gate's 403)`, async () => {
        currentUser = { id: "instb-ok-user", role: entry.role, orgId: "instb-test-org", name: "OK", email: "ok@test.invalid" }
        const mod = await import(entry.specifier)
        for (const method of entry.methods) {
          if (KNOWN_UNRELATED_ASYNC_ARTIFACT.has(`${entry.specifier}|${method}`)) {
            skippedConditional.push(`${entry.specifier} ${method}: known unrelated sibling-promise test artifact (see KNOWN_UNRELATED_ASYNC_ARTIFACT comment) -- gate itself is positioned correctly and unaffected`)
            continue
          }
          const handler = mod[method]
          let res: Response | null = null
          try {
            res = await handler(fakeRequest(method), { params: fakeParams() })
          } catch {
            res = null // threw AFTER the gate ran -- proves the gate let this caller past
          }
          if (res && res.status === 403) {
            const body = await res.clone().json().catch(() => ({}))
            if (body?.error === GATE_MESSAGE(entry.role)) { failCount++; failures.push(`${entry.specifier} ${method}: at-minimum caller (${entry.role}) still hit this gate's own 403`) }
            expect(body?.error).not.toBe(GATE_MESSAGE(entry.role))
          }
          passCount++
        }
      })
    })
  }

  test("SUMMARY (always runs last-ish, reports the sweep total)", () => {
    console.log(`INST-B/DOD-C7 sweep: ${TABLE.length} route groups, ${TABLE.reduce((n, e) => n + e.methods.length * 2, 0)} assertions attempted, ${failures.length} real failure(s), ${skippedFloorRole.length} floor-role skips, ${skippedConditional.length} known-conditional-guard skips`)
    if (failures.length) console.log("REAL FAILURES:\n" + failures.slice(0, 20).join("\n"))
    if (skippedFloorRole.length) console.log("FLOOR-ROLE SKIPS (no below-minimum caller possible, not a failure):\n" + skippedFloorRole.join("\n"))
    if (skippedConditional.length) console.log("KNOWN CONDITIONAL-GUARD SKIPS (generic body doesn't trigger the branch, not a failure):\n" + skippedConditional.join("\n"))
    const outFile = path.join(import.meta.dir, "..", "..", "..", "kt-instb", "dod-c7-sweep-result.json")
    fs.writeFileSync(outFile, JSON.stringify({ groups: TABLE.length, real_failures: failures, floor_role_skips: skippedFloorRole, known_conditional_skips: skippedConditional }, null, 2))
    expect(TABLE.length).toBeGreaterThan(0)
  })
})
