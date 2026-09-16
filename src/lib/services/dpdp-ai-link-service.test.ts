/// <reference types="bun-types" />
// WO-DPDP-004 Section 7 (AI Link test row): "All four refused categories
// rejected · unknown target_key rejected · a forged link with no session
// does nothing."
//
// Pure-logic pieces (classifyUserAgent/ipPrefix) are unit tested without a
// database. classifyProposedLine needs a real transaction (it checks the
// obligation actually exists and belongs to the org) -- real database,
// disposable org, no ROLLBACK needed since nothing here mutates any real
// obligation (classifyProposedLine only ever reads). Requires
// DATABASE_URL; skips cleanly if unset.
import { beforeAll, describe, expect, test } from "bun:test"
import { classifyUserAgent, ipPrefix, ALLOWED_VERBS, classifyProposedLine } from "./dpdp-ai-link-service"

describe("classifyUserAgent", () => {
  test("recognises the three named AI clients", () => {
    expect(classifyUserAgent("ChatGPT-User/1.0")).toBe("ChatGPT")
    expect(classifyUserAgent("Mozilla/5.0 Claude-Web/1.0")).toBe("Claude")
    expect(classifyUserAgent("Gemini-Bot")).toBe("Gemini")
  })
  test("never returns the raw string", () => {
    const raw = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    const result = classifyUserAgent(raw)
    expect(result).not.toBe(raw)
    expect(result).not.toContain("Windows")
  })
  test("null in, null out", () => {
    expect(classifyUserAgent(null)).toBeNull()
  })
})

describe("ipPrefix", () => {
  test("reduces a v4 address to its /24", () => {
    expect(ipPrefix("103.21.244.17")).toBe("103.21.244.x")
  })
  test("never returns the full address", () => {
    expect(ipPrefix("103.21.244.17")).not.toContain("17")
  })
  test("null in, null out", () => {
    expect(ipPrefix(null)).toBeNull()
  })
})

describe("ALLOWED_VERBS", () => {
  test("is exactly the five verbs WO-DPDP-004 5.10 names, no more", () => {
    expect([...ALLOWED_VERBS].sort()).toEqual(["ASSIGN", "DRAFT", "MARK_NA", "NOTE", "SET_DUE"].sort())
  })
})

// Probe-and-skip, not env-presence-and-skip -- see dpdp-task-service.test.ts's
// probeDpdpDatabase for why (CI's placeholder DATABASE_URL is truthy but
// nothing is listening there).
async function probeDpdpDatabase(): Promise<boolean> {
  if (!process.env.DATABASE_URL) return false
  const postgres = (await import("postgres")).default
  for (let attempt = 1; attempt <= 3; attempt++) {
    const probe = postgres(process.env.DATABASE_URL, { prepare: false, ssl: { rejectUnauthorized: false }, max: 1, connect_timeout: 8, idle_timeout: 1 })
    try {
      await probe`select 1`
      await probe.end({ timeout: 5 })
      return true
    } catch {
      try { await probe.end({ timeout: 5 }) } catch {}
      if (attempt < 3) await new Promise((r) => setTimeout(r, 500))
    }
  }
  return false
}
const hasDb = await probeDpdpDatabase()
const d = hasDb ? describe : describe.skip

d("classifyProposedLine (real DB, read-only)", () => {
  let orgId: string
  let obligationId: string

  beforeAll(async () => {
    if (!hasDb) return
    const { db, dpdpOrganisation, dpdpLibraryVersion, dpdpObligationTemplate, dpdpObligation } = await import("@/lib/db")
    const suffix = crypto.randomUUID().slice(0, 8)
    const [org] = await db.insert(dpdpOrganisation).values({ name: `AI Work Test ${suffix}`, slug: `ai-work-test-${suffix}` }).returning()
    orgId = org.id
    const { withDpdpContext } = await import("@/lib/db/tenant-scoped")
    await withDpdpContext({ orgId }, async (tx) => {
      const [lib] = await tx.insert(dpdpLibraryVersion).values({ version: `ai-work-${suffix}`, releasedOn: new Date().toISOString().slice(0, 10) }).returning()
      const [tpl] = await tx.insert(dpdpObligationTemplate).values({ libraryVersionId: lib.id, key: `ai_work_${suffix}`, name: "test", plainText: "test", proofKind: "declaration", defaultDays: 30, answerableBy: "internal" }).returning()
      const [ob] = await tx.insert(dpdpObligation).values({ orgId, templateId: tpl.id, libraryVersionUsed: lib.id, dueOn: new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10) }).returning()
      obligationId = ob.id
    })
  }, 30_000)

  test("an unknown verb is refused -- 'DELETE' is not on the allowlist even though it sounds plausible", async () => {
    if (!hasDb) return
    const { withDpdpContext } = await import("@/lib/db/tenant-scoped")
    const result = await withDpdpContext({ orgId }, (tx) => classifyProposedLine(tx, orgId, { verb: "DELETE", targetKey: obligationId }))
    expect(result.allowed).toBe(false)
    expect(result.refusalReason).toContain("not something an AI Link proposal may ask for")
  }, 30_000)

  test("an unknown target_key is refused, even for an allowed verb", async () => {
    if (!hasDb) return
    const { withDpdpContext } = await import("@/lib/db/tenant-scoped")
    const result = await withDpdpContext({ orgId }, (tx) => classifyProposedLine(tx, orgId, { verb: "ASSIGN", targetKey: "not-a-real-obligation-id" }))
    expect(result.allowed).toBe(false)
    expect(result.refusalReason).toContain("does not exist")
  }, 30_000)

  test("MARK_NA without a reason is refused", async () => {
    if (!hasDb) return
    const { withDpdpContext } = await import("@/lib/db/tenant-scoped")
    const result = await withDpdpContext({ orgId }, (tx) => classifyProposedLine(tx, orgId, { verb: "MARK_NA", targetKey: obligationId }))
    expect(result.allowed).toBe(false)
    expect(result.refusalReason).toContain("written reason")
  }, 30_000)

  test("MARK_NA WITH a reason, against a real obligation, is allowed", async () => {
    if (!hasDb) return
    const { withDpdpContext } = await import("@/lib/db/tenant-scoped")
    const result = await withDpdpContext({ orgId }, (tx) => classifyProposedLine(tx, orgId, { verb: "MARK_NA", targetKey: obligationId, payload: { reason: "we run no buses" } }))
    expect(result.allowed).toBe(true)
  }, 30_000)

  test("a real target belonging to a DIFFERENT org is refused (cross-tenant target_key)", async () => {
    if (!hasDb) return
    const { withDpdpContext } = await import("@/lib/db/tenant-scoped")
    const { db, dpdpOrganisation } = await import("@/lib/db")
    const [otherOrg] = await db.insert(dpdpOrganisation).values({ name: "AI Work Other Org", slug: `ai-work-other-${crypto.randomUUID().slice(0, 8)}` }).returning()
    const result = await withDpdpContext({ orgId: otherOrg.id }, (tx) => classifyProposedLine(tx, otherOrg.id, { verb: "ASSIGN", targetKey: obligationId }))
    expect(result.allowed).toBe(false)
  }, 30_000)

  test("DRAFT is allowed unconditionally -- it always creates a new, unpublished row, never targets an existing one", async () => {
    if (!hasDb) return
    const { withDpdpContext } = await import("@/lib/db/tenant-scoped")
    const result = await withDpdpContext({ orgId }, (tx) => classifyProposedLine(tx, orgId, { verb: "DRAFT", targetKey: "n/a" }))
    expect(result.allowed).toBe(true)
  }, 30_000)
})
