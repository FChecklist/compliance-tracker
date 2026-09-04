/// <reference types="bun-types" />
// R68 (Institutional Memory Graph) Phase 8, IMG-031 -- THE TWO PROOFS.
//
// IMG-031 states its own pass and fail conditions in one line each:
//
//   gate_pass: "IMG runs with only its own module enabled, and a non-entitled
//               org gets no recall."
//   gate_fail: "A non-entitled org can recall."
//
// This file is those two sentences, made falsifiable. It is deliberately NOT a
// design document -- the owner's requirement 4 ("it can be offered as a
// standalone product also") is a claim about how the software behaves, so the
// evidence for it has to be a test that would go red if the claim stopped
// being true.
//
//   PROOF 1 (behavioural, the gate_fail): an org WITHOUT the IMG entitlement is
//   genuinely refused on every real recall and write path -- not silently given
//   an empty result, which is the specific failure gate_fail names. Each
//   assertion here is run against the REAL recallMemory() /
//   resolveMemoryScope() / searchMemories() / getMemoryRecordAsOf() /
//   createMemoryRecord() functions, with only the database faked.
//
//   PROOF 2 (structural, the gate_pass): an org whose ONLY enabled product
//   branch is IMG can still use those same paths. Two halves, because either
//   alone would be weak evidence:
//     2a. behavioural -- a fixture org entitled to IMG and NOTHING else drives
//         a real recall and a real write to success.
//     2b. static -- IMG's own import closure is walked on disk and asserted to
//         contain no OTHER product branch's enablement gate. This is the half
//         that would actually catch the regression: 2a passes even if a hard
//         dependency on, say, requireErpEnabled() were added, right up until
//         someone runs it against a real database. 2b fails the moment the
//         import appears.
//
// WHAT IS NOT FAKED. The gate itself. memory-entitlement.ts runs unmocked in
// every test below; what is faked is only tx.execute() returning the rows a
// live Postgres would return. The four large existing memory test files answer
// the same query out of band (see __test-helpers__/img-entitlement-fake.ts) so
// their fixtures keep their meaning; this file is where the refusal is
// exercised for real.
import { describe, expect, test, mock, beforeEach } from "bun:test"
import { readFileSync, existsSync } from "node:fs"
import path from "node:path"
import type { TenantDb } from "@/lib/db/tenant-scoped"
import type { ActorCtx } from "./actor-context"
import { IMG_BRANCH_KEY, IMG_NOT_ENTITLED_MESSAGE, MemoryEntitlementError } from "./memory-entitlement"
import { imgEntitlementRow, isImgEntitlementQuery } from "./__test-helpers__/img-entitlement-fake"

const ORG = "org-standalone"
const ACTOR = {
  orgId: ORG,
  userId: "user-1",
  dbUser: { id: "user-1", departmentId: null },
} as unknown as ActorCtx

/** memory-write-authorization.ts's identity-only actor. */
const WRITE_ACTOR = { orgId: ORG, userId: "user-1", actorUserId: "user-1" }

beforeEach(() => {
  mock.restore()
  mock.module("@/lib/embeddings", () => ({
    storeEmbedding: mock(async () => {}),
    generateEmbedding: mock(async () => [0.1, 0.2, 0.3]),
    generateEmbeddingUncached: mock(async () => ({ vector: [0.1, 0.2, 0.3], isReal: false, model: "hash-pseudo-vector" })),
    findSimilar: mock(async () => []),
    HASH_PSEUDO_VECTOR_MODEL: "hash-pseudo-vector",
  }))
  mock.module("@/lib/db", () => ({
    db: { execute: mock(async () => [{ embedding: "[0.1,0.2,0.3]" }]) },
  }))
})

/**
 * A fake tx whose entitlement answer is under the test's control, and which
 * records every OTHER query it was asked. That second half is what makes the
 * refusal assertions meaningful: proving a refusal throws is not enough --
 * this file also proves NO memory row was ever selected or written.
 */
function makeTx(opts: { entitled: boolean; txOrgId?: string | null; rows?: unknown[][] }) {
  const nonEntitlementQueries: unknown[] = []
  let i = 0
  const execute = mock(async (q: unknown) => {
    if (isImgEntitlementQuery(q)) {
      return imgEntitlementRow(opts.entitled, opts.txOrgId === undefined ? ORG : opts.txOrgId)
    }
    nonEntitlementQueries.push(q)
    const r = opts.rows?.[i] ?? []
    i += 1
    return r
  })
  return { tx: { execute } as unknown as TenantDb, nonEntitlementQueries }
}

function sqlOf(q: unknown): string {
  return JSON.stringify(q).replaceAll('\\"', '"')
}

// ═══════════════════════════════════════════════════════════════════════
// PROOF 1 -- gate_fail: "A non-entitled org can recall." Must be FALSE.
// ═══════════════════════════════════════════════════════════════════════

describe("PROOF 1: a non-entitled org is refused on every recall path", () => {
  test("recallMemory() refuses, and reads no memory row at all", async () => {
    const { recallMemory } = await import("./memory-recall-service")
    const { tx, nonEntitlementQueries } = makeTx({ entitled: false })

    await expect(recallMemory(tx, ACTOR, "what is our retention policy?")).rejects.toThrow(MemoryEntitlementError)
    // The whole point of gate_fail: not "recalled nothing", but "never looked".
    expect(nonEntitlementQueries).toHaveLength(0)
  })

  test("resolveMemoryScope() refuses -- the deepest read path cannot be used to route around recallMemory()", async () => {
    const { resolveMemoryScope } = await import("./memory-service")
    const { tx, nonEntitlementQueries } = makeTx({ entitled: false })

    await expect(resolveMemoryScope(tx, ACTOR)).rejects.toThrow(MemoryEntitlementError)
    expect(nonEntitlementQueries).toHaveLength(0)
  })

  test("searchMemories() refuses BEFORE spending an embedding call", async () => {
    const generateEmbedding = mock(async () => [0.1, 0.2, 0.3])
    mock.module("@/lib/embeddings", () => ({ storeEmbedding: mock(async () => {}), generateEmbedding }))
    const { searchMemories } = await import("./memory-service")
    const { tx, nonEntitlementQueries } = makeTx({ entitled: false })

    await expect(searchMemories(tx, "retention policy")).rejects.toThrow(MemoryEntitlementError)
    expect(nonEntitlementQueries).toHaveLength(0)
    // A non-entitled org must not be able to spend the platform's AI budget on
    // a recall it is about to be refused.
    expect(generateEmbedding).toHaveBeenCalledTimes(0)
  })

  test("getMemoryRecordAsOf() refuses -- 'what did we believe then' is still recall", async () => {
    const { getMemoryRecordAsOf } = await import("./memory-service")
    const { tx, nonEntitlementQueries } = makeTx({ entitled: false })

    await expect(getMemoryRecordAsOf(tx, "mem-1", new Date("2026-01-01"))).rejects.toThrow(MemoryEntitlementError)
    expect(nonEntitlementQueries).toHaveLength(0)
  })

  test("the refusal is a REFUSAL, never an empty result -- no recall path resolves to []", async () => {
    const { recallMemory } = await import("./memory-recall-service")
    const { resolveMemoryScope, searchMemories } = await import("./memory-service")

    for (const run of [
      () => recallMemory(makeTx({ entitled: false }).tx, ACTOR, "q"),
      () => resolveMemoryScope(makeTx({ entitled: false }).tx, ACTOR),
      () => searchMemories(makeTx({ entitled: false }).tx, "q"),
    ]) {
      const outcome = await run().then(
        (value) => ({ resolved: true as const, value }),
        (error) => ({ resolved: false as const, error })
      )
      // If this ever flips to `resolved: true` with an empty array, IMG-031's
      // gate_fail has occurred and this assertion is the thing that says so.
      expect(outcome.resolved).toBe(false)
    }
  })

  test("the refusal names the module to buy, and carries a 403 -- never a bare 'Forbidden'", async () => {
    const { recallMemory } = await import("./memory-recall-service")
    const { tx } = makeTx({ entitled: false })

    const error = await recallMemory(tx, ACTOR, "q").catch((e: unknown) => e)
    expect(error).toBeInstanceOf(MemoryEntitlementError)
    const typed = error as MemoryEntitlementError
    expect(typed.status).toBe(403)
    expect(typed.branchKey).toBe(IMG_BRANCH_KEY)
    expect(typed.kind).toBe("not_entitled")
    expect(typed.message).toContain(IMG_NOT_ENTITLED_MESSAGE)
    expect(typed.message).toContain("Institutional Memory")
  })
})

describe("PROOF 1 (cont.): a non-entitled org is refused on every write path", () => {
  const baseInput = {
    actor: WRITE_ACTOR,
    scopeType: "ORGANIZATION" as const,
    memoryType: "FACT" as const,
    content: "the sky is blue",
    provenanceType: "USER_STATED" as const,
    originatorType: "USER" as const,
  }

  test("createMemoryRecord() refuses, and writes nothing", async () => {
    const { createMemoryRecord } = await import("./memory-service")
    const { tx, nonEntitlementQueries } = makeTx({ entitled: false })

    await expect(createMemoryRecord(tx, ORG, baseInput)).rejects.toThrow(MemoryEntitlementError)
    expect(nonEntitlementQueries).toHaveLength(0)
  })

  test("the gate runs BEFORE the three booleans -- a non-entitled org learns nothing about its own users", async () => {
    const { authorizeMemoryWrite } = await import("./memory-write-authorization")
    const { tx, nonEntitlementQueries } = makeTx({ entitled: false })

    await expect(
      authorizeMemoryWrite(tx, WRITE_ACTOR, { operation: "create", scopeType: "DEPARTMENT", scopeId: "dept-1" })
    ).rejects.toThrow(MemoryEntitlementError)
    // Boolean 1 reads compliance.users / compliance.api_keys and boolean 2
    // reads compliance.departments. Neither may run: their refusal shapes leak
    // whether a user or department id is real.
    expect(nonEntitlementQueries).toHaveLength(0)
  })

  test("an entitlement refusal is NOT reported as `allowed: false` -- it is distinguishable from an authorization failure", async () => {
    const { authorizeMemoryWrite } = await import("./memory-write-authorization")
    const { tx } = makeTx({ entitled: false })

    // authorizeMemoryWrite() normally RETURNS a decision rather than throwing.
    // Entitlement is the exception, on purpose: "your organisation has not
    // bought this product" must never be readable as "this write needed a
    // higher role", or an admin will go looking for a role to fix it.
    const outcome = await authorizeMemoryWrite(tx, WRITE_ACTOR, { operation: "create", scopeType: "ORGANIZATION" }).then(
      (decision) => ({ threw: false as const, decision }),
      (error) => ({ threw: true as const, error })
    )
    expect(outcome.threw).toBe(true)
    expect(outcome.threw && outcome.error).toBeInstanceOf(MemoryEntitlementError)
  })
})

describe("PROOF 1 (cont.): fail-closed, in both directions", () => {
  test("a transaction with no org GUC is refused -- 'unknown' is never 'allowed'", async () => {
    const { recallMemory } = await import("./memory-recall-service")
    // compliance.current_org_id() is NULLIF(current_setting(..., true), ''),
    // so an unset GUC returns NULL rather than raising. That NULL must land on
    // the refusal side.
    const { tx } = makeTx({ entitled: true, txOrgId: null })

    const error = await recallMemory(tx, ACTOR, "q").catch((e: unknown) => e)
    expect(error).toBeInstanceOf(MemoryEntitlementError)
    expect((error as MemoryEntitlementError).kind).toBe("no_org_in_transaction")
  })

  test("an entitled org cannot carry a caller claiming a DIFFERENT org past the gate", async () => {
    const { recallMemory } = await import("./memory-recall-service")
    // The transaction is genuinely scoped to, and entitled as, some other org.
    const { tx, nonEntitlementQueries } = makeTx({ entitled: true, txOrgId: "org-somebody-else" })

    const error = await recallMemory(tx, ACTOR, "q").catch((e: unknown) => e)
    expect(error).toBeInstanceOf(MemoryEntitlementError)
    expect((error as MemoryEntitlementError).kind).toBe("org_mismatch")
    expect(nonEntitlementQueries).toHaveLength(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// PROOF 2 -- gate_pass: "IMG runs with only its own module enabled."
// ═══════════════════════════════════════════════════════════════════════

describe("PROOF 2a (behavioural): an org entitled to IMG and NOTHING ELSE can recall and write", () => {
  // The fixture is exactly the standalone case: this org holds ONE
  // org_product_branch_enablements row, for `institutional_memory`. No erp, no
  // pms, no construction, no grc. If any IMG path had a hard dependency on
  // another branch's gate, these two tests are where it would surface.
  const memoryRow = {
    id: "mem-1",
    scope_type: "ORGANIZATION",
    scope_id: null,
    org_id: ORG,
    user_id: null,
    industry_id: null,
    project_id: null,
    task_id: null,
    memory_type: "RULE",
    content: "Invoices are archived for seven years",
    content_hash: "h-a",
    confidence: "0.9",
    provenance_type: "USER_STATED",
    lifecycle_state: "ACTIVE",
    source_type: null,
    source_id: null,
    registry_ref: "policy.retention",
    metadata: {},
    version: 1,
    superseded_by_id: null,
    is_personal: false,
    effective_from: new Date("2026-01-01"),
    effective_to: null,
    created_at: new Date("2026-01-01"),
    updated_at: new Date("2026-01-01"),
  }

  test("recallMemory() returns a real tier-1 answer with only the IMG branch enabled", async () => {
    const { recallMemory, takeExecutableRecord } = await import("./memory-recall-service")
    const { tx } = makeTx({ entitled: true, rows: [[memoryRow]] })

    const result = await recallMemory(tx, ACTOR, "how long do we keep invoices?", {
      registryRef: "policy.retention",
    })

    expect(result.tier).toBe("exact")
    expect(takeExecutableRecord(result)?.id).toBe("mem-1")
  })

  test("createMemoryRecord() completes a real write with only the IMG branch enabled", async () => {
    const { createMemoryRecord } = await import("./memory-service")
    const { tx, nonEntitlementQueries } = makeTx({
      entitled: true,
      rows: [
        // boolean 1: the caller resolves to a live compliance.users row
        [{ id: "user-1", role: "member", is_active: true, org_id: ORG }],
        // the INSERT ... RETURNING *
        [{ ...memoryRow, id: "mem-new", registry_ref: null, memory_type: "FACT", content: "the sky is blue" }],
      ],
    })

    const record = await createMemoryRecord(tx, ORG, {
      actor: WRITE_ACTOR,
      scopeType: "ORGANIZATION",
      memoryType: "FACT",
      content: "the sky is blue",
      provenanceType: "USER_STATED",
      originatorType: "USER",
    })

    expect(record.id).toBe("mem-new")
    // And the write really happened -- an INSERT was issued, not skipped.
    expect(nonEntitlementQueries.some((q) => sqlOf(q).includes("INSERT INTO compliance.memory_records"))).toBe(true)
  })

  test("one recall costs exactly ONE entitlement query, not one per tier", async () => {
    // recallMemory() -> recallExact() -> resolveMemoryScope() are all gated.
    // Without memoization on the transaction handle that would be two
    // round-trips out of a pool whose entire budget is five connections.
    const { recallMemory } = await import("./memory-recall-service")
    let entitlementQueries = 0
    const execute = mock(async (q: unknown) => {
      if (isImgEntitlementQuery(q)) {
        entitlementQueries += 1
        return imgEntitlementRow(true, ORG)
      }
      return [memoryRow]
    })
    const tx = { execute } as unknown as TenantDb

    await recallMemory(tx, ACTOR, "q", { registryRef: "policy.retention" })
    expect(entitlementQueries).toBe(1)
  })
})

describe("PROOF 2b (structural): IMG's import closure depends on no OTHER product branch's gate", () => {
  // The five files that ARE the IMG surface -- the write path, the recall
  // ladder, the store, the tier registry, and the entitlement gate itself.
  const IMG_SURFACE = [
    "src/lib/services/memory-service.ts",
    "src/lib/services/memory-recall-service.ts",
    "src/lib/services/memory-write-authorization.ts",
    "src/lib/services/memory-write-attribution.ts",
    "src/lib/services/memory-tier-registry.ts",
    "src/lib/services/memory-entitlement.ts",
  ]

  // Every OTHER branch's 403 gate. If IMG's closure reaches one of these, then
  // "an org with only the IMG branch enabled" would hit a refusal from a
  // product it never bought -- which is exactly the hard dependency that would
  // make the standalone claim false.
  const FOREIGN_BRANCH_GATES = [
    "requireErpEnabled",
    "requirePmsEnabled",
    "requireConstructionEnabled",
    "requireCrmEnabled",
    "requireFirmEnabled",
    "requireFmEnabled",
    "requireSalesEnabled",
    "requireVeriChatV2Enabled",
    "requireVeriRewardEnabled",
    "requireReportDomainEnabled",
  ]

  const ROOT = path.resolve(import.meta.dir, "../../..")

  /** Resolves an import specifier to a real file under src/, or null. */
  function resolveSpecifier(fromFile: string, spec: string): string | null {
    let base: string
    if (spec.startsWith("@/")) base = path.join(ROOT, "src", spec.slice(2))
    else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec)
    else return null // a package -- not ours, and cannot contain our gates
    for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
      if (existsSync(candidate)) return candidate
    }
    return null
  }

  const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+["']([^"']+)["']/g

  /** Transitive closure of first-party imports, starting from `entries`. */
  function importClosure(entries: string[]): Map<string, string> {
    const seen = new Map<string, string>()
    const queue = entries.map((e) => path.join(ROOT, e))
    while (queue.length > 0) {
      const file = queue.pop()!
      if (seen.has(file) || !existsSync(file)) continue
      const source = readFileSync(file, "utf8")
      seen.set(file, source)
      IMPORT_RE.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = IMPORT_RE.exec(source)) !== null) {
        const resolved = resolveSpecifier(file, match[1])
        if (resolved && !seen.has(resolved)) queue.push(resolved)
      }
    }
    return seen
  }

  test("the closure is real -- it actually walked past the entry files", () => {
    const closure = importClosure(IMG_SURFACE)
    // Guards the test itself: a resolver bug that returned only the 6 entries
    // would make every assertion below vacuously true.
    expect(closure.size).toBeGreaterThan(IMG_SURFACE.length)
    expect([...closure.keys()].some((f) => f.endsWith(path.join("lib", "db", "schema.ts")))).toBe(true)
  })

  /**
   * Comments must be removed before matching, and this is not a convenience --
   * without it the test reports two REAL false positives, both of which were
   * checked by hand:
   *   src/lib/db/tenant-scoped.ts:117 names requireConstructionEnabled() while
   *     documenting the 2026-09-02 pool-exhaustion chain, and
   *   src/lib/db/schema.ts:4949 says a table is "requirePmsEnabled()-gated".
   * Both are prose about other code. A test that cannot tell a call from a
   * sentence about a call would have to be silenced with an allowlist, and an
   * allowlist is where a real dependency would eventually go to hide.
   */
  function stripComments(source: string): string {
    return source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .map((line) => {
        const at = line.indexOf("//")
        return at === -1 ? line : line.slice(0, at)
      })
      .join("\n")
  }

  test("no file IMG depends on calls another product branch's 403 gate", () => {
    const closure = importClosure(IMG_SURFACE)
    const offenders: string[] = []
    for (const [file, source] of closure) {
      // A file that DEFINES its own gate is not a dependency problem; a file in
      // IMG's closure that CALLS a foreign one is. Strip the export lines so a
      // definition is not mistaken for a call.
      const body = stripComments(source).replace(/export\s+async\s+function\s+require\w+Enabled/g, "")
      for (const gate of FOREIGN_BRANCH_GATES) {
        if (body.includes(`${gate}(`)) offenders.push(`${path.relative(ROOT, file)} -> ${gate}`)
      }
    }
    expect(offenders).toEqual([])
  })

  test("the comment-stripping is not hiding a real call -- a planted one is still caught", () => {
    // Mutation check on the check. If stripComments() were over-eager (or the
    // matcher stopped working), this would go green for the wrong reason and
    // the assertion above would be worthless.
    const planted = stripComments(`
      // requireErpEnabled() is only mentioned here, in prose.
      export async function readSomething() {
        await requireErpEnabled(orgId)
      }
    `)
    expect(planted.includes("requireErpEnabled(")).toBe(true)
    const proseOnly = stripComments(`// requireErpEnabled() lives in erp-enablement-service.ts`)
    expect(proseOnly.includes("requireErpEnabled(")).toBe(false)
  })

  test("IMG does not import any other vertical's enablement service", () => {
    const closure = importClosure(IMG_SURFACE)
    const foreign = [...closure.keys()]
      .map((f) => path.basename(f))
      .filter((name) => name.endsWith("-enablement-service.ts") && name !== "img-enablement-service.ts")
    expect(foreign).toEqual([])
  })

  test("and the gate IMG does use is its own, resolved by its own branch key", () => {
    const source = readFileSync(path.join(ROOT, "src/lib/services/memory-entitlement.ts"), "utf8")
    expect(source).toContain(`export const IMG_BRANCH_KEY = "institutional_memory"`)
    // Reads the same two tables product-branch-service.ts reads -- one notion
    // of "enabled", not a second.
    expect(source).toContain("platform.product_branches")
    expect(source).toContain("compliance.org_product_branch_enablements")
    expect(source).toContain("primary_product_branch_id")
  })

  test("the enablement wrapper and the in-transaction gate share ONE branch key", () => {
    // img-enablement-service.ts (used OUTSIDE a transaction) and
    // memory-entitlement.ts (used INSIDE one) must not be able to drift onto
    // different branch keys -- if they did, an org could be "enabled" by one
    // and refused by the other, or worse, enabled by one and silently ungated
    // by the other. The wrapper imports the constant rather than restating it,
    // and this is what stops someone restating it later.
    //
    // Asserted by reading the file rather than by importing it: the wrapper
    // pulls in product-branch-service.ts, which pulls in the real "@/lib/db"
    // barrel and auth-guard.ts -- weight a unit test that stubs "@/lib/db"
    // down to one fake client cannot load. Same reason Phase 6 extracted
    // role-rank.ts as a leaf, and why memory-entitlement.ts is one.
    const wrapper = readFileSync(path.join(ROOT, "src/lib/services/img-enablement-service.ts"), "utf8")
    expect(wrapper).toContain(`from "./memory-entitlement"`)
    expect(wrapper).toContain("IMG_BRANCH_KEY")
    // A restated literal here is the drift this test exists to prevent.
    expect(wrapper).not.toMatch(/["']institutional_memory["']/)
    // ... and it really does pass that constant to the generic primitives,
    // rather than importing it and then hardcoding something else.
    for (const fn of ["isBranchEnabledForOrg", "getBranchEnablement", "enableProductBranchForOrg", "disableProductBranchForOrg"]) {
      expect(wrapper).toMatch(new RegExp(`${fn}\\([^)]*IMG_BRANCH_KEY`))
    }
  })

  test("the migration registers the same branch key the code gates on", () => {
    // A branch row under any other key would leave every org permanently
    // refused, since isBranchEnabledForOrg() resolves by branch_key.
    const raw = readFileSync(path.join(ROOT, "drizzle/0547_r68_phase8_img_product_branch.sql"), "utf8")
    // `--` comment lines stripped: this migration's own header explains its
    // ON CONFLICT strategy in prose, and prose must not be counted as SQL.
    const migration = raw
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n")

    expect(migration).toContain(`'${IMG_BRANCH_KEY}'`)
    expect(migration).toContain("INSERT INTO platform.product_branches")
    expect(migration).toContain("INSERT INTO platform.module_registry")
    expect(migration).toContain("INSERT INTO platform.product_branch_modules")
    // All three inserts idempotent, because E-103's from-empty replay really
    // does run this migration again.
    expect(migration.match(/INSERT INTO/g) ?? []).toHaveLength(3)
    expect(migration.match(/ON CONFLICT/g) ?? []).toHaveLength(3)
    // Resolved by natural key, never by an id captured on one machine --
    // product_branches.id is (gen_random_uuid())::text and differs per env.
    expect(migration).toContain("WHERE pb.branch_key = 'institutional_memory'")
  })
})
