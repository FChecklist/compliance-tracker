/// <reference types="bun-types" />
// R68 (Institutional Memory Graph) Phase 6 -- the write path's own tests.
//
// WHAT MAKES THIS FILE DIFFERENT FROM memory-service.test.ts. That file stubs
// memory-write-authorization.ts so its queue fixtures keep their existing
// indices; this file deliberately does NOT stub it. Every assertion below
// runs the REAL three-boolean gate and the REAL attribution rule, end to end
// through the real createMemoryRecord()/supersedeMemoryRecord()/
// promoteMemoryRecord()/archiveMemoryRecord(), against a queue-based fake
// `tx` standing in for the caller's withTenantContext transaction (the same
// convention every other DB-independent test in this repo uses -- no live
// Postgres is available in this sandbox/CI).
//
// AND WHAT THE REFUSAL ASSERTIONS ACTUALLY ASSERT. Not "a function was
// called". Each refusal test checks two things together: that the call
// rejects, AND that `calls.length` shows the write statement was never
// issued -- i.e. the queue still holds the INSERT/UPDATE response that a
// successful path would have consumed. A gate that threw after writing would
// pass the first check and fail the second.
import { describe, expect, test, mock, beforeEach } from "bun:test"
import type { TenantDb } from "@/lib/db/tenant-scoped"
import { imgEntitled, isImgEntitlementQuery } from "./__test-helpers__/img-entitlement-fake"

const NOW = new Date("2026-09-04T00:00:00.000Z")

function rawRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "mem-1",
    scope_type: "ORGANIZATION",
    scope_id: null,
    org_id: "org-1",
    user_id: null,
    industry_id: null,
    project_id: null,
    task_id: null,
    memory_type: "FACT",
    content: "the sky is blue",
    content_hash: "hash-1",
    confidence: null,
    provenance_type: "USER_CONFIRMED",
    lifecycle_state: "CANDIDATE",
    source_type: null,
    source_id: null,
    registry_ref: null,
    metadata: {},
    version: 1,
    superseded_by_id: null,
    is_personal: false,
    effective_from: NOW,
    effective_to: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  }
}

/** A live compliance.users row as memory-write-authorization.ts reads it. */
function userRow(overrides: Record<string, unknown> = {}) {
  return { id: "user-1", role: "member", is_active: true, org_id: "org-1", ...overrides }
}

/** A live compliance.api_keys row as memory-write-authorization.ts reads it. */
function apiKeyRow(overrides: Record<string, unknown> = {}) {
  return { id: "key-1", scopes: "read,write", is_active: true, org_id: "org-1", ...overrides }
}

function makeQueueTx(responses: unknown[][]) {
  let i = 0
  const calls: unknown[] = []
  const execute = mock(async (q: unknown) => {
    // R68 Phase 8: authorizeMemoryWrite() runs the IMG entitlement gate before
    // any of the three booleans. Answered out of band so this file's fixtures
    // keep testing exactly what they were written to test -- the three
    // booleans themselves, for an org that HAS the product. The gate refusing
    // an org that does NOT is proven in r68-phase8-packaging.test.ts.
    if (isImgEntitlementQuery(q)) return imgEntitled()
    calls.push(q)
    const r = responses[i] ?? []
    i += 1
    return r
  })
  return { tx: { execute } as unknown as TenantDb, calls }
}

function sqlOf(call: unknown): string {
  return JSON.stringify(call).replaceAll('\\"', '"')
}

beforeEach(() => {
  mock.restore()
  mock.module("@/lib/embeddings", () => ({
    storeEmbedding: mock(async () => {}),
    generateEmbedding: mock(async () => [0.1, 0.2, 0.3]),
  }))
  mock.module("@/lib/db", () => ({
    db: { execute: mock(async () => [{ embedding: "[0.1,0.2,0.3]" }]) },
  }))
})

const MEMBER_ACTOR = { orgId: "org-1", userId: "user-1", actorUserId: "user-1" }

function orgFactInput(overrides: Record<string, unknown> = {}) {
  return {
    actor: MEMBER_ACTOR,
    scopeType: "ORGANIZATION" as const,
    memoryType: "FACT" as const,
    content: "the sky is blue",
    provenanceType: "USER_CONFIRMED" as const,
    ...overrides,
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 1. THE THREE BOOLEANS, INDIVIDUALLY
// ─────────────────────────────────────────────────────────────────────────

describe("R68 Phase 6 boolean 1 -- a real caller context must exist", () => {
  test("refuses a caller that resolves to neither a live user nor a live api key, and writes NOTHING", async () => {
    const { createMemoryRecord } = await import("./memory-service")
    // [0] users lookup -> empty; [1] api_keys lookup -> empty. The INSERT
    // response is queued but must never be consumed.
    const { tx, calls } = makeQueueTx([[], [], [rawRow()], []])

    await expect(createMemoryRecord(tx, "org-1", orgFactInput())).rejects.toThrow(
      /does not resolve to a live user or api key/
    )
    expect(calls.length).toBe(2) // both lookups, and not one statement more
  })

  test("reports WHICH boolean failed, so a refusal is diagnosable", async () => {
    const { authorizeMemoryWrite } = await import("./memory-write-authorization")
    const { tx } = makeQueueTx([[], []])

    const decision = await authorizeMemoryWrite(tx, MEMBER_ACTOR, {
      operation: "create",
      scopeType: "ORGANIZATION",
    })
    expect(decision.allowed).toBe(false)
    expect(decision.callerContextResolves).toBe(false)
    expect(decision.inputsResolve).toBe(false)
    expect(decision.roleSufficient).toBe(false)
  })

  test("refuses a deactivated user even though the row exists", async () => {
    const { createMemoryRecord } = await import("./memory-service")
    const { tx, calls } = makeQueueTx([[userRow({ is_active: false })], [rawRow()], []])

    await expect(createMemoryRecord(tx, "org-1", orgFactInput())).rejects.toThrow(/is deactivated/)
    expect(calls.length).toBe(1)
  })

  test("refuses a revoked api key", async () => {
    const { createMemoryRecord } = await import("./memory-service")
    // users lookup empty -> falls through to api_keys, which is revoked.
    const { tx, calls } = makeQueueTx([[], [apiKeyRow({ is_active: false })], [rawRow()], []])

    await expect(createMemoryRecord(tx, "org-1", orgFactInput())).rejects.toThrow(/is revoked/)
    expect(calls.length).toBe(2)
  })

  test("'chain row exists': a declared chain that is not in platform.dynamic_chains refuses the write", async () => {
    const { createMemoryRecord } = await import("./memory-service")
    // [0] users -> ok; [1] dynamic_chains -> empty.
    const { tx, calls } = makeQueueTx([[userRow()], [], [rawRow()], []])

    await expect(
      createMemoryRecord(
        tx,
        "org-1",
        orgFactInput({ actor: { ...MEMBER_ACTOR, chainId: "chain-does-not-exist" } })
      )
    ).rejects.toThrow(/chain chain-does-not-exist does not exist in org org-1/)
    expect(calls.length).toBe(2)
  })

  test("a declared chain that DOES exist passes, and the decision records that it was checked", async () => {
    const { authorizeMemoryWrite } = await import("./memory-write-authorization")
    const { tx } = makeQueueTx([[userRow()], [{ id: "chain-1" }]])

    const decision = await authorizeMemoryWrite(
      tx,
      { ...MEMBER_ACTOR, chainId: "chain-1" },
      { operation: "create", scopeType: "ORGANIZATION" }
    )
    expect(decision.allowed).toBe(true)
    expect(decision.chainChecked).toBe(true)
  })

  test("no chain declared is reported as unchecked, not as silently passed", async () => {
    const { authorizeMemoryWrite } = await import("./memory-write-authorization")
    const { tx } = makeQueueTx([[userRow()]])
    const decision = await authorizeMemoryWrite(tx, MEMBER_ACTOR, { operation: "create", scopeType: "ORGANIZATION" })
    expect(decision.allowed).toBe(true)
    expect(decision.chainChecked).toBe(false)
  })
})

describe("R68 Phase 6 boolean 2 -- the write's inputs must resolve against real data", () => {
  test("a DEPARTMENT-scoped write naming a department that does not exist in this org is refused, and writes NOTHING", async () => {
    const { createMemoryRecord } = await import("./memory-service")
    // [0] users (manager, so the role bar is met); [1] departments -> empty.
    const { tx, calls } = makeQueueTx([[userRow({ role: "manager" })], [], [rawRow()], []])

    await expect(
      createMemoryRecord(
        tx,
        "org-1",
        orgFactInput({ scopeType: "DEPARTMENT", scopeId: "dept-nope" })
      )
    ).rejects.toThrow(/department dept-nope does not exist in org org-1/)
    expect(calls.length).toBe(2)
  })

  test("a USER-scoped write naming a user who is not in this org is refused", async () => {
    const { createMemoryRecord } = await import("./memory-service")
    // [0] caller (admin, so the cross-user role bar is met); [1] target user -> empty.
    const { tx, calls } = makeQueueTx([[userRow({ role: "admin" })], [], [rawRow()], []])

    await expect(
      createMemoryRecord(tx, "org-1", orgFactInput({ scopeType: "USER", userId: "user-from-another-tenant" }))
    ).rejects.toThrow(/user user-from-another-tenant does not exist in org org-1/)
    expect(calls.length).toBe(2)
  })

  test("a supersede whose target row belongs to a different org is refused before any write", async () => {
    const { supersedeMemoryRecord } = await import("./memory-service")
    // [0] SELECT the old row (a fixture from another org -- in production RLS
    // would already have hidden it; this proves the gate does not depend on
    // RLS having done so); [1] caller lookup.
    const { tx, calls } = makeQueueTx([[rawRow({ org_id: "org-2" })], [userRow({ role: "admin" })], [], [rawRow()], []])

    await expect(
      supersedeMemoryRecord(tx, "mem-1", "new content", { actor: MEMBER_ACTOR, type: "USER" })
    ).rejects.toThrow(/GLOBAL\/INDUSTRY|belongs to org org-2/)
    // 1 read only: the pre-existing org-mismatch guard rejects it, and in the
    // absence of that guard the gate's boolean 2 would. Either way, no write.
    expect(calls.length).toBeLessThanOrEqual(2)
  })
})

describe("R68 Phase 6 boolean 3 -- the caller must hold the minimum role for this write", () => {
  test("a viewer cannot write institutional memory at all, and writes NOTHING", async () => {
    const { createMemoryRecord } = await import("./memory-service")
    const { tx, calls } = makeQueueTx([[userRow({ role: "viewer" })], [rawRow()], []])

    await expect(createMemoryRecord(tx, "org-1", orgFactInput())).rejects.toThrow(
      /requires member or higher; user-1 is viewer/
    )
    expect(calls.length).toBe(1)
  })

  test("an external_auditor cannot write institutional memory either (rank 1, same floor)", async () => {
    const { createMemoryRecord } = await import("./memory-service")
    const { tx, calls } = makeQueueTx([[userRow({ role: "external_auditor" })], [rawRow()], []])

    await expect(createMemoryRecord(tx, "org-1", orgFactInput())).rejects.toThrow(/is external_auditor/)
    expect(calls.length).toBe(1)
  })

  test("a member CAN write an ordinary org-scoped memory (the real run-submission path still works)", async () => {
    const { createMemoryRecord } = await import("./memory-service")
    const { tx, calls } = makeQueueTx([[userRow({ role: "member" })], [rawRow()], []])

    const record = await createMemoryRecord(tx, "org-1", orgFactInput())
    expect(record.id).toBe("mem-1")
    expect(calls.length).toBe(3) // caller lookup + INSERT + embedding mirror
    expect(sqlOf(calls[1])).toContain("INSERT INTO compliance.memory_records")
  })

  test("a member cannot write a DEPARTMENT-scoped memory (that needs manager)", async () => {
    const { createMemoryRecord } = await import("./memory-service")
    // [0] caller (member); [1] departments -> the department really exists,
    // so boolean 2 passes and this is unambiguously a ROLE refusal.
    const { tx, calls } = makeQueueTx([[userRow({ role: "member" })], [{ id: "dept-1" }], [rawRow()], []])

    await expect(
      createMemoryRecord(tx, "org-1", orgFactInput({ scopeType: "DEPARTMENT", scopeId: "dept-1" }))
    ).rejects.toThrow(/requires manager or higher; user-1 is member/)
    expect(calls.length).toBe(2)
  })

  test("a manager CAN write a DEPARTMENT-scoped memory", async () => {
    const { createMemoryRecord } = await import("./memory-service")
    const { tx, calls } = makeQueueTx([
      [userRow({ role: "manager" })],
      [{ id: "dept-1" }],
      [rawRow({ scope_type: "DEPARTMENT", scope_id: "dept-1" })],
      [],
    ])

    const record = await createMemoryRecord(
      tx,
      "org-1",
      orgFactInput({ scopeType: "DEPARTMENT", scopeId: "dept-1" })
    )
    expect(record.scopeType).toBe("DEPARTMENT")
    expect(calls.length).toBe(4)
  })

  test("a member cannot write into ANOTHER user's USER-scoped memory (that needs admin)", async () => {
    const { createMemoryRecord } = await import("./memory-service")
    const { tx, calls } = makeQueueTx([[userRow({ role: "member" })], [{ id: "user-2" }], [rawRow()], []])

    await expect(
      createMemoryRecord(tx, "org-1", orgFactInput({ scopeType: "USER", userId: "user-2" }))
    ).rejects.toThrow(/requires admin or higher; user-1 is member/)
    expect(calls.length).toBe(2)
  })

  test("a member CAN write their OWN USER-scoped memory (the real chat-service path still works)", async () => {
    const { createMemoryRecord } = await import("./memory-service")
    const { tx, calls } = makeQueueTx([
      [userRow({ role: "member" })],
      [{ id: "user-1" }],
      [rawRow({ scope_type: "USER", user_id: "user-1" })],
      [],
    ])

    const record = await createMemoryRecord(tx, "org-1", orgFactInput({ scopeType: "USER", userId: "user-1" }))
    expect(record.userId).toBe("user-1")
    expect(calls.length).toBe(4)
  })

  test("an api-key caller without the write scope is refused; with it, allowed (auth-guard's own scope axis)", async () => {
    const { authorizeMemoryWrite } = await import("./memory-write-authorization")

    const readOnly = makeQueueTx([[], [apiKeyRow({ scopes: "read" })]])
    const refused = await authorizeMemoryWrite(readOnly.tx, MEMBER_ACTOR, {
      operation: "create",
      scopeType: "ORGANIZATION",
    })
    expect(refused.allowed).toBe(false)
    expect(refused.callerContextResolves).toBe(true)
    expect(refused.inputsResolve).toBe(true)
    expect(refused.roleSufficient).toBe(false)
    expect(refused.reason).toMatch(/not write-scoped/)

    const writable = makeQueueTx([[], [apiKeyRow({ scopes: "read,write" })]])
    const allowed = await authorizeMemoryWrite(writable.tx, MEMBER_ACTOR, {
      operation: "create",
      scopeType: "ORGANIZATION",
    })
    expect(allowed.allowed).toBe(true)
    expect(allowed.resolvedRole).toBeNull()
  })

  test("changing existing ORGANIZATION memory needs manager, while creating one needs only member", async () => {
    const { requiredRoleForMemoryWrite } = await import("./memory-write-authorization")
    expect(requiredRoleForMemoryWrite(MEMBER_ACTOR, { operation: "create", scopeType: "ORGANIZATION" })).toBe("member")
    for (const operation of ["supersede", "promote", "archive"] as const) {
      expect(requiredRoleForMemoryWrite(MEMBER_ACTOR, { operation, scopeType: "ORGANIZATION" })).toBe("manager")
    }
  })

  test("promoteMemoryRecord refuses a member promoting an ORGANIZATION-scoped memory, and writes NOTHING", async () => {
    const { promoteMemoryRecord } = await import("./memory-service")
    // [0] fetch the row; [1] caller lookup (member).
    const { tx, calls } = makeQueueTx([
      [rawRow({ lifecycle_state: "CANDIDATE" })],
      [userRow({ role: "member" })],
      [rawRow({ lifecycle_state: "CONFIRMED" })],
    ])

    await expect(
      promoteMemoryRecord(tx, "mem-1", "CONFIRMED", { actor: MEMBER_ACTOR, type: "USER" })
    ).rejects.toThrow(/requires manager or higher/)
    expect(calls.length).toBe(2)
  })

  test("archiveMemoryRecord refuses a viewer, and writes NOTHING", async () => {
    const { archiveMemoryRecord } = await import("./memory-service")
    const { tx, calls } = makeQueueTx([
      [rawRow({ scope_type: "USER", user_id: "user-1", lifecycle_state: "ACTIVE" })],
      [userRow({ role: "viewer" })],
      [rawRow({ lifecycle_state: "ARCHIVED" })],
    ])

    await expect(archiveMemoryRecord(tx, "mem-1", { actor: MEMBER_ACTOR, type: "USER" })).rejects.toThrow(
      /is viewer/
    )
    expect(calls.length).toBe(2)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// 2. THE DECISION IS SERVER-SIDE. A CLIENT CANNOT ASSERT IT.
// ─────────────────────────────────────────────────────────────────────────

describe("R68 Phase 6 -- a client-supplied authorization claim is refused, not ignored", () => {
  test.each([
    ["authorized", { authorized: true }],
    ["isAuthorized", { isAuthorized: true }],
    ["role", { role: "admin" }],
    ["permissions", { permissions: ["memory:write"] }],
    ["bypassAuthorization", { bypassAuthorization: true }],
  ])("rejects an actor carrying `%s` before it touches the database", async (_label, claim) => {
    const { createMemoryRecord } = await import("./memory-service")
    const { tx, calls } = makeQueueTx([[userRow({ role: "admin" })], [rawRow()], []])

    await expect(
      createMemoryRecord(tx, "org-1", orgFactInput({ actor: { ...MEMBER_ACTOR, ...claim } }))
    ).rejects.toThrow(/client-supplied authorization claim/)
    // Zero queries: the smuggled field is caught before the gate even reads a
    // row, so a forged claim can never be "considered and then overruled".
    expect(calls.length).toBe(0)
  })

  test("an actor whose orgId disagrees with the row's org is refused (no silent identity change, E-45's own rule)", async () => {
    const { createMemoryRecord } = await import("./memory-service")
    const { tx, calls } = makeQueueTx([[userRow({ role: "admin" })], [rawRow()], []])

    await expect(
      createMemoryRecord(tx, "org-1", orgFactInput({ actor: { ...MEMBER_ACTOR, orgId: "org-2" } }))
    ).rejects.toThrow(/does not match the orgId this record is being written for/)
    expect(calls.length).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// 3. ATTRIBUTION ON AI-ORIGINATED WRITES
// ─────────────────────────────────────────────────────────────────────────

describe("R68 Phase 6 -- an AI write with no attribution is refused (R-IMG-07)", () => {
  test("createMemoryRecord refuses an AI-originated write with no modelId/promptHash, before any query", async () => {
    const { createMemoryRecord } = await import("./memory-service")
    const { tx, calls } = makeQueueTx([[userRow({ role: "admin" })], [rawRow()], []])

    await expect(
      createMemoryRecord(tx, "org-1", orgFactInput({ originatorType: "AI" }))
    ).rejects.toThrow(/AI-originated \(changedBy.type is 'AI'\) but is missing modelId and promptHash/)
    expect(calls.length).toBe(0)
  })

  test("provenanceType 'AI_INFERRED' demands attribution even when a human pressed the button", async () => {
    const { createMemoryRecord } = await import("./memory-service")
    const { tx, calls } = makeQueueTx([[userRow({ role: "admin" })], [rawRow()], []])

    await expect(
      createMemoryRecord(
        tx,
        "org-1",
        orgFactInput({ originatorType: "USER", provenanceType: "AI_INFERRED" })
      )
    ).rejects.toThrow(/provenanceType is 'AI_INFERRED'/)
    expect(calls.length).toBe(0)
  })

  test("half-attribution is still no attribution (modelId without promptHash)", async () => {
    const { createMemoryRecord } = await import("./memory-service")
    const { tx } = makeQueueTx([[userRow({ role: "admin" })], [rawRow()], []])

    await expect(
      createMemoryRecord(
        tx,
        "org-1",
        orgFactInput({ originatorType: "AI", modelId: "anthropic/claude-sonnet-5" })
      )
    ).rejects.toThrow(/is missing promptHash/)
  })

  test("whitespace is not attribution", async () => {
    const { assertAttributionComplete } = await import("./memory-write-attribution")
    expect(() =>
      assertAttributionComplete("test", { originatorType: "AI", modelId: "   ", promptHash: "  " })
    ).toThrow(/missing modelId and promptHash/)
  })

  test("a REAL AI write persists model, prompt hash, caller and chain onto the row", async () => {
    const { createMemoryRecord } = await import("./memory-service")
    const { tx, calls } = makeQueueTx([
      [userRow({ role: "admin" })],
      [{ id: "chain-1" }],
      [rawRow({ provenance_type: "AI_INFERRED" })],
      [],
    ])

    await createMemoryRecord(
      tx,
      "org-1",
      orgFactInput({
        actor: { ...MEMBER_ACTOR, chainId: "chain-1" },
        provenanceType: "AI_INFERRED",
        originatorType: "AI",
        originatorId: "assistant-run-77",
        modelId: "anthropic/claude-sonnet-5",
        promptHash: "sha256:8f14e45fceea167a5a36dedd4bea2543",
      })
    )

    const insertSql = sqlOf(calls[2])
    expect(insertSql).toContain("INSERT INTO compliance.memory_records")
    // All four facts R-IMG-07 names: which model, which prompt hash, which
    // caller, which chain.
    expect(insertSql).toContain('"modelId":"anthropic/claude-sonnet-5"')
    expect(insertSql).toContain('"promptHash":"sha256:8f14e45fceea167a5a36dedd4bea2543"')
    expect(insertSql).toContain('"originatorType":"AI"')
    expect(insertSql).toContain('"originatorId":"assistant-run-77"')
    expect(insertSql).toContain('"chainId":"chain-1"')
  })

  test("a non-AI write records the caller and chain with NULL model/prompt -- truthful, not a gap", async () => {
    const { createMemoryRecord } = await import("./memory-service")
    const { tx, calls } = makeQueueTx([[userRow({ role: "member" })], [rawRow()], []])

    await createMemoryRecord(tx, "org-1", orgFactInput({ originatorType: "SYSTEM" }))

    const insertSql = sqlOf(calls[1])
    expect(insertSql).toContain('"originatorType":"SYSTEM"')
    expect(insertSql).toContain('"modelId":null')
    expect(insertSql).toContain('"promptHash":null')
  })

  test("existing metadata keys survive the attribution stamp", async () => {
    const { createMemoryRecord } = await import("./memory-service")
    const { tx, calls } = makeQueueTx([[userRow({ role: "member" })], [rawRow()], []])

    await createMemoryRecord(tx, "org-1", orgFactInput({ metadata: { sourceNote: "keep me" } }))
    const insertSql = sqlOf(calls[1])
    expect(insertSql).toContain('"sourceNote":"keep me"')
    expect(insertSql).toContain('"attribution"')
  })

  test("supersedeMemoryRecord persists model_id/prompt_hash onto the memory_versions snapshot", async () => {
    const { supersedeMemoryRecord } = await import("./memory-service")
    const oldRow = rawRow({ version: 3, content: "the sky is blue", content_hash: "hash-old", scope_type: "USER", user_id: "user-1" })
    const newRow = rawRow({ id: "mem-2", version: 4, content: "the sky is cyan", lifecycle_state: "ACTIVE" })
    // [0] SELECT old row; [1] caller lookup; [2] INSERT memory_versions;
    // [3] INSERT new memory_records; [4] UPDATE old row; [5] embedding mirror.
    const { tx, calls } = makeQueueTx([[oldRow], [userRow({ role: "admin" })], [], [newRow], [], []])

    await supersedeMemoryRecord(tx, "mem-1", "the sky is cyan", {
      actor: MEMBER_ACTOR,
      type: "AI",
      reason: "corrected by a later observation",
      modelId: "anthropic/claude-sonnet-5",
      promptHash: "sha256:deadbeef",
    })

    const versionsSql = sqlOf(calls[2])
    expect(versionsSql).toContain("INSERT INTO compliance.memory_versions")
    expect(versionsSql).toContain("model_id")
    expect(versionsSql).toContain("prompt_hash")
    expect(versionsSql).toContain("anthropic/claude-sonnet-5")
    expect(versionsSql).toContain("sha256:deadbeef")
    // ...and the NEW row carries this revision's own attribution, not the
    // superseded row's.
    expect(sqlOf(calls[3])).toContain('"modelId":"anthropic/claude-sonnet-5"')
  })

  test("supersedeMemoryRecord refuses an unattributed AI revision before it snapshots anything", async () => {
    const { supersedeMemoryRecord } = await import("./memory-service")
    const oldRow = rawRow({ version: 3, content_hash: "hash-old", scope_type: "USER", user_id: "user-1" })
    const { tx, calls } = makeQueueTx([[oldRow], [userRow({ role: "admin" })], [], [rawRow({ id: "mem-2" })], [], []])

    await expect(
      supersedeMemoryRecord(tx, "mem-1", "the sky is cyan", { actor: MEMBER_ACTOR, type: "AI" })
    ).rejects.toThrow(/is missing modelId and promptHash/)
    expect(calls.length).toBe(1) // the row was read; nothing was written
  })

  test("promoteMemoryRecord records model/prompt/chain in the lifecycle history it appends", async () => {
    const { promoteMemoryRecord } = await import("./memory-service")
    const { tx, calls } = makeQueueTx([
      [rawRow({ scope_type: "USER", user_id: "user-1", lifecycle_state: "CANDIDATE" })],
      [userRow({ role: "member" })],
      [{ id: "chain-9" }],
      [rawRow({ scope_type: "USER", user_id: "user-1", lifecycle_state: "CONFIRMED" })],
    ])

    await promoteMemoryRecord(tx, "mem-1", "CONFIRMED", {
      actor: { ...MEMBER_ACTOR, chainId: "chain-9" },
      type: "AI",
      reason: "model confirmed it against the ledger",
      modelId: "anthropic/claude-sonnet-5",
      promptHash: "sha256:cafebabe",
    })

    const updateSql = sqlOf(calls[3])
    expect(updateSql).toContain('"modelId":"anthropic/claude-sonnet-5"')
    expect(updateSql).toContain('"promptHash":"sha256:cafebabe"')
    expect(updateSql).toContain('"chainId":"chain-9"')
  })
})

// ─────────────────────────────────────────────────────────────────────────
// 4. THE GATE RUNS BEFORE THE NO-OP SHORTCUT
// ─────────────────────────────────────────────────────────────────────────

describe("R68 Phase 6 -- an unauthorized caller cannot use the byte-identical no-op as a probe", () => {
  test("supersede with UNCHANGED content is still refused for an unauthorized caller", async () => {
    const { supersedeMemoryRecord } = await import("./memory-service")
    const { createHash } = await import("crypto")
    const content = "the sky is blue"
    const hash = createHash("sha256").update(content).digest("hex")
    // Same content as the row already holds: the no-op branch would return
    // success and reveal that this id exists and is superseded-able.
    const oldRow = rawRow({ content, content_hash: hash, scope_type: "USER", user_id: "user-2" })
    const { tx, calls } = makeQueueTx([[oldRow], [userRow({ role: "member" })]])

    await expect(
      supersedeMemoryRecord(tx, "mem-1", content, { actor: MEMBER_ACTOR, type: "USER" })
    ).rejects.toThrow(/requires admin or higher/)
    expect(calls.length).toBe(2)
  })
})
