/// <reference types="bun-types" />
// Wave A (VERIDIAN Review Framework remediation, 2026-07-17, security/bug
// quick-fix item 1): this file had zero test coverage before this wave.
// Covers validateApiKey()'s new demo-key environment gate (KNOWN_DEMO_KEY_IDS
// + DEMO_API_KEY_IDS allowlist) with `@/lib/db` mock.module()'d out, matching
// orchestra-model-resolver.test.ts's established pattern for this kind of
// dependency (never touching a live DB from a .test.ts file).
import { describe, test, expect, mock, afterEach, beforeEach } from "bun:test"

function mockDbFor(row: Record<string, unknown> | undefined) {
  mock.module("@/lib/db", () => ({
    db: {
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
      insert: () => ({ values: () => Promise.resolve() }),
      select: () => ({ from: () => ({ where: () => Promise.resolve([{ count: 0 }]) }) }),
    },
    apiKeys: {}, apiKeyRequestLog: {},
  }))
  // CRR-028 expand step: validateApiKey() now resolves the key via
  // lookupApiKeyByHash() (src/lib/db/preauth-lookups.ts, calls the
  // SECURITY DEFINER compliance.lookup_api_key_by_hash function) instead of
  // db.query.apiKeys.findFirst directly -- mock that module instead of
  // db.query so this suite exercises the real current call path rather than
  // a stale one.
  mock.module("@/lib/db/preauth-lookups", () => ({
    lookupApiKeyByHash: mock(async () => row ?? null),
  }))
  mock.module("@/lib/api-keys", () => ({ hashSHA256: mock(async () => "hash-doesnt-matter") }))
}

function demoKeyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "projexa_demo_key",
    orgId: "projexa_demo_org",
    name: "PROJEXA Frontend Service Key",
    scopes: "read,write",
    rateLimitPerMinute: null,
    isActive: true,
    ...overrides,
  }
}

function request() {
  return new Request("https://example.com/api/v1/whatever", {
    headers: { authorization: "Bearer vk_test_token" },
  })
}

describe("validateApiKey: demo-key environment gate", () => {
  const originalEnv = process.env.DEMO_API_KEY_IDS

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.DEMO_API_KEY_IDS
    else process.env.DEMO_API_KEY_IDS = originalEnv
  })

  test("rejects the known demo key (projexa_demo_key) when DEMO_API_KEY_IDS is unset -- the current production default", async () => {
    delete process.env.DEMO_API_KEY_IDS
    mockDbFor(demoKeyRow())

    const { validateApiKey } = await import("./api-key-auth")
    const result = await validateApiKey(request())
    expect(result.status).toBe("invalid")
  })

  test("rejects the known demo key when DEMO_API_KEY_IDS is set to unrelated ids", async () => {
    process.env.DEMO_API_KEY_IDS = "some_other_key,another_key"
    mockDbFor(demoKeyRow())

    const { validateApiKey } = await import("./api-key-auth")
    const result = await validateApiKey(request())
    expect(result.status).toBe("invalid")
  })

  test("allows the known demo key once explicitly allowlisted via DEMO_API_KEY_IDS", async () => {
    process.env.DEMO_API_KEY_IDS = "projexa_demo_key"
    mockDbFor(demoKeyRow())

    const { validateApiKey } = await import("./api-key-auth")
    const result = await validateApiKey(request())
    expect(result.status).toBe("ok")
    if (result.status === "ok") {
      expect(result.context.orgId).toBe("projexa_demo_org")
    }
  })

  test("a real, non-demo key is completely unaffected by this gate regardless of DEMO_API_KEY_IDS", async () => {
    delete process.env.DEMO_API_KEY_IDS
    mockDbFor({
      id: "a-real-provisioned-cuid-id",
      orgId: "org-1",
      name: "Real customer key",
      scopes: "read",
      rateLimitPerMinute: null,
      isActive: true,
    })

    const { validateApiKey } = await import("./api-key-auth")
    const result = await validateApiKey(request())
    expect(result.status).toBe("ok")
  })

  test("an inactive/missing key is still rejected as invalid, unrelated to the demo-key gate", async () => {
    mockDbFor(undefined)
    const { validateApiKey } = await import("./api-key-auth")
    const result = await validateApiKey(request())
    expect(result.status).toBe("invalid")
  })
})

// VERIDIAN Review Framework gap-closure (2026-08-15, "API Developer
// Experience" -- Sandbox/test environment for API integrators): covers the
// DEMO_KEY_RATE_LIMIT_PER_MINUTE safety ceiling applied to demo/sandbox keys
// once they're allowlisted, independent of what the DB row itself says.
describe("validateApiKey: demo-key sandbox rate-limit ceiling", () => {
  const originalEnv = process.env.DEMO_API_KEY_IDS

  beforeEach(() => {
    process.env.DEMO_API_KEY_IDS = "projexa_demo_key"
  })

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.DEMO_API_KEY_IDS
    else process.env.DEMO_API_KEY_IDS = originalEnv
  })

  function mockDbForWithCount(row: Record<string, unknown> | undefined, count: number) {
    mock.module("@/lib/db", () => ({
      db: {
        update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
        insert: () => ({ values: () => Promise.resolve() }),
        select: () => ({ from: () => ({ where: () => Promise.resolve([{ count }]) }) }),
      },
      apiKeys: {}, apiKeyRequestLog: {},
    }))
    // Same CRR-028 preauth-lookup call path as mockDbFor() above -- keep this
    // suite's mock shape consistent with the rest of the file's current
    // (post-CRR-028) mocking pattern rather than the older direct
    // db.query.apiKeys.findFirst shape.
    mock.module("@/lib/db/preauth-lookups", () => ({
      lookupApiKeyByHash: mock(async () => row ?? null),
    }))
    mock.module("@/lib/api-keys", () => ({ hashSHA256: mock(async () => "hash-doesnt-matter") }))
  }

  test("an allowlisted demo key with rateLimitPerMinute: null (unlimited in the DB) is still capped at the sandbox ceiling", async () => {
    mockDbForWithCount(demoKeyRow({ rateLimitPerMinute: null }), 30)

    const { validateApiKey } = await import("./api-key-auth")
    const result = await validateApiKey(request())
    expect(result.status).toBe("rate_limited")
  })

  test("an allowlisted demo key under the sandbox ceiling still succeeds", async () => {
    mockDbForWithCount(demoKeyRow({ rateLimitPerMinute: null }), 5)

    const { validateApiKey } = await import("./api-key-auth")
    const result = await validateApiKey(request())
    expect(result.status).toBe("ok")
  })

  test("a demo key with a DB-configured limit stricter than the sandbox ceiling still uses the stricter DB limit", async () => {
    mockDbForWithCount(demoKeyRow({ rateLimitPerMinute: 5 }), 5)

    const { validateApiKey } = await import("./api-key-auth")
    const result = await validateApiKey(request())
    expect(result.status).toBe("rate_limited")
  })

  test("a real, non-demo key with rateLimitPerMinute: null is unaffected by the sandbox ceiling -- stays unlimited", async () => {
    mockDbForWithCount(
      { id: "a-real-provisioned-cuid-id", orgId: "org-1", name: "Real customer key", scopes: "read", rateLimitPerMinute: null, isActive: true },
      1000,
    )

    const { validateApiKey } = await import("./api-key-auth")
    const result = await validateApiKey(request())
    expect(result.status).toBe("ok")
  })
})

// R43_EXEC_01 (Critical, closed as a false positive by R52/R56/R60 -- the
// row's own cross-org observation was an id-space mixup, not a real leak;
// see platform.r43_faults justification). No code fix landed for this row.
// What IS security-critical, and had zero regression coverage before this
// suite, is the invariant R52/R56/R60 actually verified by hand each time:
// validateApiKey() must resolve `context.orgId` ONLY from the DB row matched
// by the presented Bearer token's hash (via lookupApiKeyByHash) -- never
// from any other caller-controllable signal on the request (a header, a
// query param, etc.). If that ever stopped being true, PROJEXA's
// server-to-server calls (or any other API-key caller) could potentially
// assert a different tenant's orgId and this function would hand back
// another org's context, which is the exact cross-tenant leak this fault
// row worried about. This is a real regression guard, not a restatement of
// the existing demo-key-gate tests above: confirmed failing (asserts
// "org-attacker" but got "org-mine") against a deliberately introduced
// `x-org-id` header override patched into validateApiKey() locally, and
// passing again once that patch was reverted -- see PR description for the
// stash/restore output.
// R67 F-17 (R-234): the two audit writes -- the api_key_request_log INSERT and
// the api_keys.last_used_at UPDATE -- used to be issued per request on the
// shared max:5 `db` pool (see src/lib/db/index.ts's own R43_EXEC_02 comment,
// which names them as part of what serialised that pool into 504s). They now go
// through the batching queue in src/lib/auth/api-key-audit.ts. These two tests
// cover the CALL SITE: that validateApiKey stopped issuing them per request,
// and that batching them did not quietly widen the rate-limit window.
describe("validateApiKey: the audit writes are batched, and the rate limit still counts them (R67 F-17)", () => {
  const originalEnv = process.env.DEMO_API_KEY_IDS

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.DEMO_API_KEY_IDS
    else process.env.DEMO_API_KEY_IDS = originalEnv
  })

  /**
   * A db stub whose rate-limit count reflects the rows it has actually been
   * given -- i.e. it models the database honestly rather than returning a fixed
   * number. That makes the assertions below independent of exactly when the
   * queue chooses to flush: a request is counted once, whether it is still in
   * the queue or already written.
   */
  function mockDbCountingItsOwnWrites(row: Record<string, unknown>, baseCount: number) {
    const state = { batches: 0, rowsWritten: 0, lastUsedUpdates: 0 }
    mock.module("@/lib/db", () => ({
      db: {
        update: () => ({ set: () => ({ where: () => { state.lastUsedUpdates += 1; return Promise.resolve() } }) }),
        insert: () => ({
          values: (rows: unknown) => {
            const list = Array.isArray(rows) ? rows : [rows]
            state.batches += 1
            state.rowsWritten += list.length
            return Promise.resolve()
          },
        }),
        select: () => ({ from: () => ({ where: () => Promise.resolve([{ count: baseCount + state.rowsWritten }]) }) }),
      },
      apiKeys: { id: "id" }, apiKeyRequestLog: {},
    }))
    mock.module("@/lib/db/preauth-lookups", () => ({ lookupApiKeyByHash: mock(async () => row) }))
    mock.module("@/lib/api-keys", () => ({ hashSHA256: mock(async () => "hash-doesnt-matter") }))
    return state
  }

  /** Drains anything earlier tests in this file queued, so deltas are ours. */
  async function drainAuditQueue() {
    const { flushApiKeyAuditNow } = await import("@/lib/auth/api-key-audit")
    await flushApiKeyAuditNow()
    // Let any previously scheduled deferral (after()/setImmediate) run to
    // completion before measuring.
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    await flushApiKeyAuditNow()
  }

  test("ten requests issue ZERO writes while they run, then one INSERT and one last_used_at UPDATE", async () => {
    const state = mockDbCountingItsOwnWrites({
      id: "f17-real-key", orgId: "org-f17", name: "Real customer key",
      scopes: "read", rateLimitPerMinute: null, isActive: true,
    }, 0)

    const { validateApiKey } = await import("./api-key-auth")
    const { flushApiKeyAuditNow } = await import("@/lib/auth/api-key-audit")
    await drainAuditQueue()

    const before = { batches: state.batches, rows: state.rowsWritten, updates: state.lastUsedUpdates }

    for (let i = 0; i < 10; i += 1) {
      const result = await validateApiKey(request())
      expect(result.status).toBe("ok")
    }

    // The point of the item: a PROJEXA page's worth of API-key calls no longer
    // puts two statements each on a five-connection pool.
    expect(state.batches - before.batches).toBe(0)
    expect(state.lastUsedUpdates - before.updates).toBe(0)

    await flushApiKeyAuditNow()

    expect(state.batches - before.batches).toBe(1)
    expect(state.rowsWritten - before.rows).toBe(10)
    // Ten requests, one "last used" date. The column's only readers are the
    // settings screen's "Last used <date>" line and the stale-key audit loop.
    expect(state.lastUsedUpdates - before.updates).toBe(1)
  })

  test("a key at its limit is still rate-limited on requests that are only in the queue, not yet in the database", async () => {
    process.env.DEMO_API_KEY_IDS = "projexa_demo_key"
    // Limit 2/minute, and the database starts empty -- so anything that stops
    // the third request can only have come from the queue's pending count.
    const state = mockDbCountingItsOwnWrites(demoKeyRow({ rateLimitPerMinute: 2 }), 0)

    const { validateApiKey } = await import("./api-key-auth")
    await drainAuditQueue()
    const rowsBefore = state.rowsWritten

    expect((await validateApiKey(request())).status).toBe("ok")
    expect((await validateApiKey(request())).status).toBe("ok")

    // Nothing has reached the database yet...
    expect(state.rowsWritten - rowsBefore).toBe(0)
    // ...and the limit holds anyway.
    const third = await validateApiKey(request())
    expect(third.status).toBe("rate_limited")
    if (third.status === "rate_limited") {
      expect(third.retryAfterSeconds).toBe(60)
    }
  })
})

describe("validateApiKey: orgId comes only from the key-hash match (R43_EXEC_01 regression guard)", () => {
  test("an x-org-id header claiming a different tenant is ignored -- orgId still comes from the key's own row", async () => {
    mockDbFor({
      id: "real-key-mine",
      orgId: "org-mine",
      name: "My real key",
      scopes: "read",
      rateLimitPerMinute: null,
      isActive: true,
    })

    const { validateApiKey } = await import("./api-key-auth")
    const spoofedRequest = new Request("https://example.com/api/v1/projects", {
      headers: {
        authorization: "Bearer vk_test_token",
        // A naive implementation might trust a caller-supplied org header
        // for multi-tenant routing. validateApiKey() must never do this --
        // the only trustworthy source of orgId is the row the key's own
        // hash resolves to.
        "x-org-id": "org-attacker",
      },
    })
    const result = await validateApiKey(spoofedRequest)
    expect(result.status).toBe("ok")
    if (result.status === "ok") {
      expect(result.context.orgId).toBe("org-mine")
      expect(result.context.orgId).not.toBe("org-attacker")
    }
  })

  test("an orgId query parameter on the request URL is ignored -- orgId still comes from the key's own row", async () => {
    mockDbFor({
      id: "real-key-mine",
      orgId: "org-mine",
      name: "My real key",
      scopes: "read",
      rateLimitPerMinute: null,
      isActive: true,
    })

    const { validateApiKey } = await import("./api-key-auth")
    const spoofedRequest = new Request("https://example.com/api/v1/projects?orgId=org-attacker", {
      headers: { authorization: "Bearer vk_test_token" },
    })
    const result = await validateApiKey(spoofedRequest)
    expect(result.status).toBe("ok")
    if (result.status === "ok") {
      expect(result.context.orgId).toBe("org-mine")
      expect(result.context.orgId).not.toBe("org-attacker")
    }
  })

  test("two different keys (different hashes) resolve to their own, independent orgId -- no cross-key contamination", async () => {
    // Simulates two tenants' keys by re-mocking hashSHA256 to distinguish
    // the token, and lookupApiKeyByHash to return each key's own row only
    // for its own hash -- the closest a unit test can get to proving key A's
    // request can never come back with key B's orgId.
    mock.module("@/lib/db", () => ({
      db: {
        update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
        insert: () => ({ values: () => Promise.resolve() }),
        select: () => ({ from: () => ({ where: () => Promise.resolve([{ count: 0 }]) }) }),
      },
      apiKeys: {}, apiKeyRequestLog: {},
    }))
    mock.module("@/lib/api-keys", () => ({
      hashSHA256: mock(async (token: string) => `hash-of-${token}`),
    }))
    mock.module("@/lib/db/preauth-lookups", () => ({
      lookupApiKeyByHash: mock(async (hash: string) => {
        if (hash === "hash-of-vk_tenant_a_token") {
          return { id: "key-a", orgId: "org-a", name: "Tenant A key", scopes: "read", rateLimitPerMinute: null, isActive: true }
        }
        if (hash === "hash-of-vk_tenant_b_token") {
          return { id: "key-b", orgId: "org-b", name: "Tenant B key", scopes: "read", rateLimitPerMinute: null, isActive: true }
        }
        return null
      }),
    }))

    const { validateApiKey } = await import("./api-key-auth")
    const resultA = await validateApiKey(new Request("https://example.com/api/v1/projects", {
      headers: { authorization: "Bearer vk_tenant_a_token" },
    }))
    const resultB = await validateApiKey(new Request("https://example.com/api/v1/projects", {
      headers: { authorization: "Bearer vk_tenant_b_token" },
    }))

    expect(resultA.status).toBe("ok")
    expect(resultB.status).toBe("ok")
    if (resultA.status === "ok" && resultB.status === "ok") {
      expect(resultA.context.orgId).toBe("org-a")
      expect(resultB.context.orgId).toBe("org-b")
      expect(resultA.context.orgId).not.toBe(resultB.context.orgId)
    }
  })
})

// ---------------------------------------------------------------------------
// R67 F-33 (audit recommendation R-278, latency_backend_evidence.md item 6):
// the usage bookkeeping runs AFTER the response.
//
// Both writes were already un-awaited, which is not the same as being off the
// critical path -- they still queue on the same five-connection pool the
// request's own queries use, and a bare promise can be killed the moment the
// response is sent.
//
// CORRECTED BY THE R67 INTEGRATION MERGE (F-33 x F-17, decision D-11). These
// four tests were written against F-33's own afterResponse() helper, which
// called next/server's after() twice per request -- once per write. That helper
// is gone: lane F1's batching queue (src/lib/auth/api-key-audit.ts) now owns
// both writes and SUBSUMES the deferral, scheduling ONE flush through after()
// rather than two writes. Every guarantee these tests were protecting is still
// asserted here, against the merged mechanism instead of the deleted one:
// the writes are still ISSUED (a "fast" auth that quietly stopped logging is a
// regression, not a fix), the flush is scheduled through next/server's after()
// when a request scope exists, it degrades rather than drops when there is
// none, and a failing write is LOGGED rather than left as an unhandled
// rejection. Two assertions necessarily changed with the mechanism: the after()
// count is 1, not 2, and the log prefix is the queue's own [api-key-audit].
// ---------------------------------------------------------------------------
describe("validateApiKey: usage bookkeeping is deferred, and never silently lost", () => {
  function mockDbRecording(writes: string[], keyId: string, failWith?: Error) {
    mock.module("@/lib/db", () => ({
      db: {
        update: () => ({ set: () => ({ where: () => { writes.push("last_used_at"); return failWith ? Promise.reject(failWith) : Promise.resolve() } }) }),
        insert: () => ({ values: () => { writes.push("request_log"); return failWith ? Promise.reject(failWith) : Promise.resolve() } }),
        select: () => ({ from: () => ({ where: () => Promise.resolve([{ count: 0 }]) }) }),
      },
      apiKeys: {}, apiKeyRequestLog: {},
    }))
    mock.module("@/lib/api-keys", () => ({ hashSHA256: mock(async () => "hash") }))
    mock.module("@/lib/db/preauth-lookups", () => ({
      lookupApiKeyByHash: mock(async () => ({
        // A key id of its own per test: the queue writes last_used_at at most
        // once per key per minute, so a shared id would make the second test in
        // this block assert a write the throttle had correctly suppressed.
        id: keyId, orgId: "org-real", name: "Real key", scopes: "read,write", rateLimitPerMinute: null, isActive: true,
      })),
    }))
  }

  /** Stands in for the Next runtime's after(): `mode` picks which of the two
   *  situations the audit queue has to survive. */
  function mockAfter(mode: "runs" | "captures" | "no-request-scope", captured: Array<() => unknown> = []) {
    mock.module("next/server", () => ({
      after: (fn: () => unknown) => {
        if (mode === "captures") { captured.push(fn); return }
        if (mode === "no-request-scope") throw new Error("`after` was called outside a request scope")
        void fn()
      },
    }))
    return captured
  }

  const authRequest = () => new Request("https://example.com/api/v1/projexa/schedule", {
    method: "POST", headers: { authorization: "Bearer vk_real" },
  })

  /** Empties anything earlier tests in this file left queued, so the writes
   *  recorded below are only the ones this test caused. */
  async function drainInto(writes: string[]) {
    const { flushApiKeyAuditNow } = await import("@/lib/auth/api-key-audit")
    await flushApiKeyAuditNow()
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    await flushApiKeyAuditNow()
    writes.length = 0
  }

  test("both writes are still issued on a successful auth -- nothing stopped being recorded", async () => {
    mockAfter("runs")
    const writes: string[] = []
    mockDbRecording(writes, "key-real-issued")
    const { validateApiKey } = await import("./api-key-auth")
    const { flushApiKeyAuditNow } = await import("@/lib/auth/api-key-audit")
    await drainInto(writes)

    const result = await validateApiKey(authRequest())

    expect(result.status).toBe("ok")
    await flushApiKeyAuditNow()
    expect(writes.sort()).toEqual(["last_used_at", "request_log"])
  })

  test("the flush is scheduled through next/server's after(), so the runtime keeps the invocation alive for it", async () => {
    const writes: string[] = []
    mockDbRecording(writes, "key-real-deferred")
    const { validateApiKey } = await import("./api-key-auth")
    const { MAX_BUFFERED_ROWS, flushApiKeyAuditNow } = await import("@/lib/auth/api-key-audit")
    await drainInto(writes)

    // Captured, not run -- and armed deterministically by filling the buffer,
    // rather than depending on whether an earlier test in this file already
    // consumed the queue's one immediate first-request flush.
    const scheduled = mockAfter("captures")
    for (let i = 0; i < MAX_BUFFERED_ROWS; i += 1) {
      expect((await validateApiKey(authRequest())).status).toBe("ok")
    }

    // Handed to after(), NOT run beside the request. ONE flush for the lot --
    // that is F-17's contribution on top of F-33's deferral.
    expect(scheduled).toHaveLength(1)
    expect(writes).toHaveLength(0)
    for (const run of scheduled) await run()
    // The scheduled callback starts the flush without returning it (nothing may
    // block on an audit write), so wait for the flush chain itself.
    await flushApiKeyAuditNow()
    expect(writes.sort()).toEqual(["last_used_at", "request_log"])
  })

  test("with no request scope at all (a script, a test) the writes still happen -- the deferral degrades, it does not drop them", async () => {
    const writes: string[] = []
    mockDbRecording(writes, "key-real-no-scope")
    const { validateApiKey } = await import("./api-key-auth")
    const { MAX_BUFFERED_ROWS } = await import("@/lib/auth/api-key-audit")
    await drainInto(writes)

    mockAfter("no-request-scope")
    for (let i = 0; i < MAX_BUFFERED_ROWS; i += 1) {
      expect((await validateApiKey(authRequest())).status).toBe("ok")
    }

    // after() threw; the queue falls back to setImmediate rather than losing
    // the batch.
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    await new Promise<void>((resolve) => { setImmediate(resolve) })
    expect(writes.sort()).toEqual(["last_used_at", "request_log"])
  })

  test("a failing write is logged with its reason, and never rejects the request that had already been answered", async () => {
    mockAfter("runs")
    const writes: string[] = []
    mockDbRecording(writes, "key-real-failing", new Error("remaining connection slots are reserved"))
    const { validateApiKey } = await import("./api-key-auth")
    const { flushApiKeyAuditNow } = await import("@/lib/auth/api-key-audit")
    await drainInto(writes)

    const errors: unknown[][] = []
    const originalError = console.error
    console.error = (...args: unknown[]) => { errors.push(args) }
    try {
      const result = await validateApiKey(authRequest())
      expect(result.status).toBe("ok")
      await flushApiKeyAuditNow()
    } finally {
      console.error = originalError
    }

    const messages = errors.map((args) => args.map(String).join(" "))
    expect(messages.some((m) => m.includes("[api-key-audit]") && m.includes("remaining connection slots are reserved"))).toBe(true)
  })
})
