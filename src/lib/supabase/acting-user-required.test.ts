/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-20b -- register row BR-215 (and the code side of
// BR-216/BR-217): an API-key write ALWAYS names a person.
//
// Live finding D-09: every audit row written through PROJEXA's shared org API
// key carried no person (267 of 267 had user_id null), and most v1 write
// routes stored the api_keys row id where a compliance.users id belongs
// (`ctx.dbUser?.id ?? ctx.apiKey!.id`). auth-guard.ts's requireActingPerson()
// is now the one place that rule lives; this file proves it three ways.
//
//   1. The REAL helper: an API key with no X-Acting-User / X-Acting-User-Email
//      and no body actorEmail is refused with 400 ACTING_USER_REQUIRED; a
//      linked person resolves, and `actor` carries the person AND the key; an
//      unlinked one keeps resolveActingUser's own 400 USER_NOT_LINKED; a
//      session user is unchanged; no auth is 401.
//   2. THREE REAL CONVERTED ROUTE HANDLERS of different shapes, run end to end
//      with only the database and the network faked:
//        - POST /api/v1/projexa/rfis              person id -> the service's
//          userId -> constructionRfis.raisedById;
//        - POST /api/v1/compliance                ServiceActor -> compliance-
//          service -> logActivity -> one audit row with user_id AND api_key_id;
//        - POST /api/v1/projexa/inventory/warehouses  ActorCtx -> erp-stock-
//          service -> auditActorOf -> the same audit row shape.
//      Real: requireAuthOrApiKey, validateApiKey, requireRoleOrScope,
//      requireActingPerson, resolveActingUser, the three routes, the three
//      services, logActivity. Faked: @/lib/db's raw client (the users lookup),
//      withTenantContext's transaction (a recorder of every insert),
//      preauth-lookups (the api_keys/users SECURITY DEFINER reads), the
//      api-key audit queue, and the Supabase auth client. Assertions read what
//      the faked DB layer RECEIVED, not what the route answered.
//   3. A DRIFT GUARD (same pattern as authz-gap-inventory.test.ts and
//      org-guard-sweep.test.ts): it walks every route.ts under src/app/api and
//      fails when a handler uses the API key's own id -- or a key-only actor
//      object -- as an actor anywhere outside ALLOWLIST below, each entry
//      carrying the reason it is not an actor. The next new route cannot
//      silently bring D-09 back.
//
// Falsifiability (R74-RULING-03 (c)) is recorded in the U-20b PR/report: the
// helper put back to "no signal -> the key id" fails parts 1 and 2, and a
// planted `ctx.dbUser?.id ?? ctx.apiKey!.id` in a route fails part 3.
import { describe, test, expect, mock, beforeEach } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join, dirname, relative, sep } from "node:path"
import { NextRequest } from "next/server"

const ORG = "org-u20b"

const PERSON = {
  id: "user-arjun", orgId: ORG, name: "Arjun Mehta", email: "arjun@example.test",
  role: "manager", isActive: true, authUserId: "projexa-arjun",
}
const SESSION_USER = {
  id: "user-priya", orgId: ORG, name: "Priya Shah", email: "priya@example.test",
  role: "admin", isActive: true, authUserId: "auth-priya",
}
const API_KEY_ROW = { id: "key-1", orgId: ORG, name: "PROJEXA org key", scopes: "read,write", isActive: true, rateLimitPerMinute: null }

type Row = Record<string, unknown>
const state = {
  userLookups: [] as Array<Row | undefined>,
  userLookupCalls: 0,
  inserts: [] as Array<{ table: unknown; values: Row }>,
  tenantContexts: [] as Array<{ orgId: string; userId?: string }>,
  sessionAuthUser: null as Row | null,
}

beforeEach(() => {
  state.userLookups = []
  state.userLookupCalls = 0
  state.inserts = []
  state.tenantContexts = []
  state.sessionAuthUser = null
})

// ── The faked database and network ─────────────────────────────────────────
const realDb = await import("@/lib/db")
const realTenant = await import("@/lib/db/tenant-scoped")
const realPreauth = await import("@/lib/db/preauth-lookups")
const realKeyAudit = await import("@/lib/auth/api-key-audit")
const realServer = await import("@/lib/supabase/server")

// resolveActingUser's lookups go through the raw client; each call is
// answered from `state.userLookups` in order, so a test says exactly which
// lookup finds whom (the same harness auth-guard.test.ts uses).
mock.module("@/lib/db", () => ({
  ...realDb,
  db: {
    query: {
      users: { findFirst: mock(async () => { state.userLookupCalls++; return state.userLookups.shift() }) },
      organisations: { findFirst: mock(async () => undefined) },
      accessReviewCertifications: { findFirst: mock(async () => undefined) },
    },
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  },
}))

// Every tenant transaction gets a recorder: inserts are kept (table + values)
// and handed back as the created row, reads return fixed rows.
function fakeTx() {
  const reads: Record<string, Row | undefined> = {
    departments: { id: "dept-1", orgId: ORG, name: "Projects" },
    productBranches: { id: "branch-erp", branchKey: "erp" },
    organisations: { id: ORG, primaryProductBranchId: "branch-erp" },
  }
  return {
    query: new Proxy({}, { get: (_t, table) => ({ findFirst: async () => reads[String(table)], findMany: async () => [] }) }),
    insert: (table: unknown) => ({
      values: (values: Row) => {
        state.inserts.push({ table, values })
        const row = { id: `row-${state.inserts.length}`, status: "open", clientId: null, createdAt: new Date(), updatedAt: new Date(), ...values }
        return Object.assign(Promise.resolve(undefined), { returning: async () => [row] })
      },
    }),
    select: () => ({ from: () => ({ where: async () => [{ value: 0 }] }) }),
    execute: async () => [],
  }
}
mock.module("@/lib/db/tenant-scoped", () => ({
  ...realTenant,
  withTenantContext: async (context: { orgId: string; userId?: string }, fn: (tx: unknown) => Promise<unknown>) => {
    state.tenantContexts.push(context)
    return fn(fakeTx())
  },
}))

mock.module("@/lib/db/preauth-lookups", () => ({
  ...realPreauth,
  lookupApiKeyByHash: mock(async () => API_KEY_ROW),
  countRecentApiKeyRequests: mock(async () => 0),
  lookupUserByEmail: mock(async () => SESSION_USER),
}))
mock.module("@/lib/auth/api-key-audit", () => ({
  ...realKeyAudit,
  recordApiKeyUse: mock(async () => undefined),
  pendingApiKeyRequestCount: mock(() => 0),
}))
mock.module("@/lib/supabase/server", () => ({
  ...realServer,
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.sessionAuthUser } }),
      getSession: async () => ({ data: { session: null } }),
    },
  }),
}))

const authGuard = await import("./auth-guard")
const { auditLogs, constructionRfis, complianceItems, erpWarehouses } = realDb

function insertsInto(table: unknown) {
  return state.inserts.filter((i) => i.table === table).map((i) => i.values)
}

function keyRequest(path: string, body: unknown, acting: Record<string, string> = {}) {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { authorization: "Bearer vk_u20b_test_key", "content-type": "application/json", ...acting },
    body: JSON.stringify(body),
  })
}

const KEY_CTX = { orgId: ORG, dbUser: null, apiKey: { id: "key-1", name: "PROJEXA org key", scopes: ["read", "write"] }, response: null }

// ── 1. The real helper ─────────────────────────────────────────────────────
describe("requireActingPerson -- the one rule (BR-215)", () => {
  test("API key, no X-Acting-User, no X-Acting-User-Email, no actorEmail: 400 ACTING_USER_REQUIRED naming both headers", async () => {
    const { acting, error } = await authGuard.requireActingPerson({ headers: new Headers() }, KEY_CTX as never)
    expect(acting).toBeNull()
    expect(error!.status).toBe(400)
    const body = await error!.json()
    expect(body.code).toBe("ACTING_USER_REQUIRED")
    expect(body.error).toContain("X-Acting-User")
    expect(body.error).toContain("X-Acting-User-Email")
    expect(state.userLookupCalls).toBe(0)
  })

  test("API key naming a linked person: that person, and `actor` carries the person AND the key", async () => {
    state.userLookups = [PERSON]
    const { acting, error } = await authGuard.requireActingPerson(
      { headers: new Headers({ "X-Acting-User": "projexa-arjun" }) },
      KEY_CTX as never
    )
    expect(error).toBeNull()
    expect(acting!.person.id).toBe(PERSON.id)
    expect(acting!.actor).toEqual({ dbUser: PERSON, apiKey: { id: "key-1", name: "PROJEXA org key" }, actingViaApiKey: true })
  })

  test("a body actorEmail (the older server-to-server shape) names the person too", async () => {
    state.userLookups = [PERSON]
    const { acting, error } = await authGuard.requireActingPerson({ headers: new Headers() }, KEY_CTX as never, { actorEmail: "arjun@example.test" })
    expect(error).toBeNull()
    expect(acting!.person.id).toBe(PERSON.id)
  })

  test("an acting-user id linked to nobody keeps resolveActingUser's own 400 USER_NOT_LINKED", async () => {
    state.userLookups = [undefined]
    const { acting, error } = await authGuard.requireActingPerson(
      { headers: new Headers({ "X-Acting-User": "projexa-nobody" }) },
      KEY_CTX as never
    )
    expect(acting).toBeNull()
    expect(error!.status).toBe(400)
    const body = await error!.json()
    expect(body.code).toBe("USER_NOT_LINKED")
    expect(body.error).toBe(authGuard.USER_NOT_LINKED_MESSAGE)
  })

  test("a deactivated person keeps resolveActingUser's own 400 USER_DEACTIVATED", async () => {
    state.userLookups = [{ ...PERSON, isActive: false }]
    const { error } = await authGuard.requireActingPerson({ headers: new Headers({ "X-Acting-User": "projexa-arjun" }) }, KEY_CTX as never)
    expect((await error!.json()).code).toBe("USER_DEACTIVATED")
  })

  test("a session user is unchanged: that user, no lookup, no key in the actor", async () => {
    const sessionCtx = { orgId: ORG, dbUser: SESSION_USER, apiKey: null, response: null }
    const { acting, error } = await authGuard.requireActingPerson({ headers: new Headers({ "X-Acting-User": "projexa-arjun" }) }, sessionCtx as never)
    expect(error).toBeNull()
    expect(acting!.person.id).toBe(SESSION_USER.id)
    expect(acting!.actor).toEqual({ dbUser: SESSION_USER })
    expect(state.userLookupCalls).toBe(0)
  })

  test("no session and no key is 401", async () => {
    const { error } = await authGuard.requireActingPerson({ headers: new Headers() }, { orgId: null, dbUser: null, apiKey: null, response: null } as never)
    expect(error!.status).toBe(401)
  })

  test("resolveWriteActorId no longer falls back to the key id either", async () => {
    const { actorId, error } = await authGuard.resolveWriteActorId({ headers: new Headers() }, KEY_CTX as never)
    expect(actorId).toBeNull()
    expect((await error!.json()).code).toBe("ACTING_USER_REQUIRED")
  })
})

// ── 2. Three real converted routes, only the DB and network faked ─────────
describe("POST /api/v1/projexa/rfis -- person id reaches the entity's actor column", () => {
  const RFI = { projectId: "project-1", subject: "Rebar grade", question: "Grade 40 or 60?" }

  test("API key naming nobody: 400 ACTING_USER_REQUIRED and nothing is written", async () => {
    const { POST } = await import("@/app/api/v1/projexa/rfis/route")
    const res = await POST(keyRequest("/api/v1/projexa/rfis", RFI))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe("ACTING_USER_REQUIRED")
    expect(state.inserts).toHaveLength(0)
  })

  test("API key naming a linked person: 201, and raisedById is the person -- never the key id", async () => {
    state.userLookups = [PERSON]
    const { POST } = await import("@/app/api/v1/projexa/rfis/route")
    const res = await POST(keyRequest("/api/v1/projexa/rfis", RFI, { "X-Acting-User": "projexa-arjun" }))
    expect(res.status).toBe(201)
    const written = insertsInto(constructionRfis)
    expect(written).toHaveLength(1)
    expect(written[0].raisedById).toBe(PERSON.id)
    expect(written[0].raisedById).not.toBe("key-1")
    expect(state.tenantContexts.at(-1)).toEqual({ orgId: ORG, userId: PERSON.id })
  })

  test("API key naming an unlinked person: 400 USER_NOT_LINKED and nothing is written", async () => {
    state.userLookups = [undefined]
    const { POST } = await import("@/app/api/v1/projexa/rfis/route")
    const res = await POST(keyRequest("/api/v1/projexa/rfis", RFI, { "X-Acting-User": "projexa-nobody" }))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe("USER_NOT_LINKED")
    expect(state.inserts).toHaveLength(0)
  })
})

describe("POST /api/v1/compliance -- ServiceActor: one audit row names the person AND the key", () => {
  const ITEM = { title: "GSTR-3B September", complianceType: "gst", dueDate: "2026-10-20", departmentId: "dept-1" }

  test("API key naming a linked person: 201, the item is written and its audit row has user_id AND api_key_id", async () => {
    state.userLookups = [PERSON]
    const { POST } = await import("@/app/api/v1/compliance/route")
    const res = await POST(keyRequest("/api/v1/compliance", ITEM, { "X-Acting-User": "projexa-arjun" }))
    expect(res.status).toBe(201)
    expect(insertsInto(complianceItems)).toHaveLength(1)
    const audit = insertsInto(auditLogs)
    expect(audit).toHaveLength(1)
    expect(audit[0].userId).toBe(PERSON.id)
    expect(audit[0].apiKeyId).toBe("key-1")
    expect(audit[0].actorName).toBe(PERSON.name)
    expect(audit[0].actorRole).toBe(PERSON.role)
  })

  test("API key naming nobody: 400 ACTING_USER_REQUIRED, no item and no audit row", async () => {
    const { POST } = await import("@/app/api/v1/compliance/route")
    const res = await POST(keyRequest("/api/v1/compliance", ITEM))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe("ACTING_USER_REQUIRED")
    expect(state.inserts).toHaveLength(0)
  })

  test("a session user is unchanged: 201, audit row user_id is the session user, api_key_id null, no acting lookup", async () => {
    state.sessionAuthUser = { id: "auth-priya", email: SESSION_USER.email }
    const { POST } = await import("@/app/api/v1/compliance/route")
    const res = await POST(new NextRequest("http://localhost/api/v1/compliance", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(ITEM),
    }))
    expect(res.status).toBe(201)
    const audit = insertsInto(auditLogs)
    expect(audit).toHaveLength(1)
    expect(audit[0].userId).toBe(SESSION_USER.id)
    expect(audit[0].apiKeyId).toBeNull()
    expect(state.userLookupCalls).toBe(0)
  })
})

describe("POST /api/v1/projexa/inventory/warehouses -- ActorCtx through auditActorOf", () => {
  test("API key naming the person by X-Acting-User-Email: 201, audit row has user_id AND api_key_id", async () => {
    state.userLookups = [PERSON]
    const { POST } = await import("@/app/api/v1/projexa/inventory/warehouses/route")
    const res = await POST(keyRequest("/api/v1/projexa/inventory/warehouses", { warehouseName: "Site Store A" }, { "X-Acting-User-Email": PERSON.email }))
    expect(res.status).toBe(201)
    expect(insertsInto(erpWarehouses)).toHaveLength(1)
    const audit = insertsInto(auditLogs)
    expect(audit).toHaveLength(1)
    expect(audit[0].userId).toBe(PERSON.id)
    expect(audit[0].apiKeyId).toBe("key-1")
    expect(state.tenantContexts.at(-1)).toEqual({ orgId: ORG, userId: PERSON.id })
  })

  test("API key naming nobody: 400 ACTING_USER_REQUIRED, no warehouse and no audit row", async () => {
    const { POST } = await import("@/app/api/v1/projexa/inventory/warehouses/route")
    const res = await POST(keyRequest("/api/v1/projexa/inventory/warehouses", { warehouseName: "Site Store A" }))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe("ACTING_USER_REQUIRED")
    expect(state.inserts).toHaveLength(0)
  })
})

// ── 3. The drift guard ─────────────────────────────────────────────────────
//
// Pure text over comment-stripped source (the same "reviewable, not a
// compiler" class as org-guard-sweep.test.ts). Three shapes each mean "the
// key, not a person, is the actor":
//   - `apiKey.id` / `apiKey!.id` / `apiKey?.id`         the key's own row id;
//   - `apiKey: ctx.apiKey`                               a key-only actor
//                                                        object (logActivity,
//                                                        ActorCtx, ServiceActor);
//   - `ctx.dbUser?.id ?? null`                           "no person" for every
//                                                        API-key call.
const KEY_AS_ACTOR_PATTERNS: RegExp[] = [/\bapiKey[!?]?\.id\b/g, /\bapiKey:\s*ctx\.apiKey\b/g, /\bctx\.dbUser\?\.id\s*\?\?\s*null\b/g]

/**
 * Every route that still uses one of the shapes above, how many times, and
 * why it is not an API-key WRITE recording the key as its actor. A new use --
 * in a new file, or one more in a listed file -- fails the sweep below; so
 * does an entry whose uses are gone (update this list in the same change).
 */
export const ALLOWLIST: Record<string, { count: number; reason: string }> = {
  "src/app/api/v1/brain/entity-relationships/route.ts": { count: 1, reason: "GET only: the key id is the RLS reader context for a neighbour lookup; nothing is written" },
  "src/app/api/v1/projexa/capability-tree/route.ts": { count: 1, reason: "GET only: RLS reader context for building the construction tree; nothing is written" },
  "src/app/api/v1/projexa/chain-options/route.ts": { count: 1, reason: "GET only: reader context for the next chain options; nothing is written" },
  "src/app/api/v1/projexa/module-chain/route.ts": { count: 1, reason: "GET only: ranks the chain by the named person when one is sent (resolveOptionalActingPerson); a key-only read keeps the key's legacy ranking" },
  "src/app/api/v1/projexa/pill-usage/route.ts": { count: 1, reason: "GET only: reads the strip of the named person when one is sent; a key-only read keeps the key's legacy strip. The POST uses requireActingPerson" },
  "src/app/api/v1/projexa/documents/[id]/route.ts": { count: 2, reason: "GET view audit: person AND key when the caller names one; a key-only read with no signal is served and keeps its key-attributed view row (a read is not refused) -- PROJEXA should send the headers on this GET too (BR-216)" },
  "src/app/api/v1/projexa/assistant/route.ts": { count: 1, reason: "PM decision U-01d D1: the pipeline surface redacts and never refuses; pipeline userId is not a users FK and reaches logActivity only when it matches a users row; person-attributed executors use actorUserId" },
  "src/app/api/v1/projexa/tasks/route.ts": { count: 1, reason: "PM decision U-01d D1: same pipeline surface as assistant; person-attributed executors use actorUserId (resolved from actorEmail) and refuse without it" },
  "src/app/api/v1/projexa/submissions/route.ts": { count: 1, reason: "PM decision U-01d D1: same pipeline surface as assistant" },
  "src/app/api/v1/projexa/classify/route.ts": { count: 1, reason: "read-scope classification (POST only to carry the text): writes nothing but gap_log rows, no audit row" },
  "src/app/api/v1/projexa/reports/definitions/[id]/run/route.ts": { count: 1, reason: "read-only report execution (POST only to carry params); the id only keys AI usage logging" },
  "src/app/api/v1/reports/definitions/[id]/run/route.ts": { count: 1, reason: "the external-AI reporting gateway (read / read:reports keys, no person to name); read-only report execution" },
}

/** Replaces every comment with spaces, keeping line numbers; string literals are left alone. */
export function stripComments(src: string): string {
  let out = ""
  let i = 0
  let quote: string | null = null
  while (i < src.length) {
    const c = src[i]
    const n = src[i + 1]
    if (quote) {
      out += c
      if (c === "\\") { out += n ?? ""; i += 2; continue }
      if (c === quote) quote = null
      i++
      continue
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; out += c; i++; continue }
    if (c === "/" && n === "/") { while (i < src.length && src[i] !== "\n") { out += " "; i++ } continue }
    if (c === "/" && n === "*") {
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) { out += src[i] === "\n" ? "\n" : " "; i++ }
      out += "  "
      i += 2
      continue
    }
    out += c
    i++
  }
  return out
}

export type KeyActorUse = { line: number; snippet: string }

/** Every key-as-actor use in one file's source (comments ignored). */
export function findKeyActorUses(source: string): KeyActorUse[] {
  const code = stripComments(source)
  const uses: KeyActorUse[] = []
  code.split("\n").forEach((text, idx) => {
    for (const re of KEY_AS_ACTOR_PATTERNS) {
      re.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = re.exec(text))) uses.push({ line: idx + 1, snippet: text.trim().slice(0, 160) })
    }
  })
  return uses
}

function listRouteFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listRouteFiles(full))
    else if (entry.isFile() && entry.name === "route.ts") out.push(full)
  }
  return out
}

const REPO_ROOT = join(dirname(import.meta.dir), "..", "..")
const API_DIR = join(REPO_ROOT, "src", "app", "api")

describe("drift guard: detector self-test on synthetic source", () => {
  test("catches the D-09 fallback, a key-only actor object and the null-person shape", () => {
    expect(findKeyActorUses("  const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id\n")).toHaveLength(1)
    expect(findKeyActorUses("  const actorId = ctx.dbUser?.id ?? ctx.apiKey?.id\n")).toHaveLength(1)
    expect(findKeyActorUses("  : { orgId: ctx.orgId, userId: ctx.apiKey!.id, apiKey: ctx.apiKey! }\n")).toHaveLength(2)
    expect(findKeyActorUses("  ...(ctx.dbUser ? { dbUser: ctx.dbUser } : { apiKey: ctx.apiKey! }),\n")).toHaveLength(1)
    expect(findKeyActorUses("  const actorId = ctx.dbUser?.id ?? null\n")).toHaveLength(1)
  })

  test("ignores the same text in comments, and never flags the resolved person", () => {
    expect(findKeyActorUses("// was ctx.dbUser?.id ?? ctx.apiKey!.id\n/* ctx.apiKey!.id */\n")).toHaveLength(0)
    expect(findKeyActorUses("  const actorId = acting.person.id\n  const actorCtx = { orgId: ctx.orgId, userId: actorId, ...acting.actor }\n")).toHaveLength(0)
  })
})

describe("drift guard: no route uses the API key as an actor outside the allowlist", () => {
  const files = listRouteFiles(API_DIR)
  const found = new Map<string, KeyActorUse[]>()
  for (const file of files) {
    const uses = findKeyActorUses(readFileSync(file, "utf8"))
    if (uses.length > 0) found.set(relative(REPO_ROOT, file).split(sep).join("/"), uses)
  }

  test("the sweep actually read the route tree", () => {
    expect(files.length).toBeGreaterThan(1000)
  })

  test("every key-as-actor use is in ALLOWLIST, with exactly the allowed count", () => {
    const violations: string[] = []
    for (const [file, uses] of found) {
      const allowed = ALLOWLIST[file]
      if (!allowed) {
        violations.push(`${file}: ${uses.map((u) => `L${u.line} ${u.snippet}`).join(" | ")}`)
      } else if (uses.length !== allowed.count) {
        violations.push(`${file}: ${uses.length} use(s), allowlisted for ${allowed.count}: ${uses.map((u) => `L${u.line} ${u.snippet}`).join(" | ")}`)
      }
    }
    // Resolve the person with requireActingPerson (auth-guard.ts) instead, or,
    // only if this is genuinely not an API-key write, add a reasoned entry.
    expect(violations).toEqual([])
  })

  test("no stale allowlist entry: every listed file still has its uses", () => {
    const stale = Object.keys(ALLOWLIST).filter((file) => !found.has(file))
    expect(stale).toEqual([])
  })

  test("every allowlist entry says why", () => {
    const unexplained = Object.entries(ALLOWLIST).filter(([, entry]) => entry.reason.trim().length < 20).map(([file]) => file)
    expect(unexplained).toEqual([])
  })
})
