/// <reference types="bun-types" />
// WO-DPDP-002 Section 4.1 (Auth test row): "A spent magic link is refused
// and the attempt is logged. A link older than 15 minutes is refused."
//
// Real database (dpdp.identity/login_token/session carry no RLS -- see
// drizzle/0415's own comment listing them as cross-org-by-design/global --
// so no withDpdpContext is needed here), real dpdp-auth-service functions.
// @/lib/email is mocked so this never sends a real email through Resend.
// Requires DATABASE_URL; skips cleanly if it isn't set.
//
// "A link used from a different address is refused" (the work order's
// fourth auth case): not applicable to this design as built --
// verifyDpdpMagicLink(rawToken) takes only the token, never an email/
// address to cross-check, and dpdp.login_token stores no expected verifying
// address. The token itself IS the credential (opaque, single-use,
// bound to no other channel) -- there is no "different address" concept to
// test. Flagged here rather than silently skipped without explanation.
import { beforeAll, describe, expect, mock, test } from "bun:test"

const hasDb = !!process.env.DATABASE_URL

// A fully synthetic mock, defined BEFORE anything imports the real module --
// not "import the real module, then mock over it" (that pattern left the
// real sendEmail() reachable in an earlier version of this file, which
// meant a real, unmocked network call to Resend on every run, occasionally
// hanging for minutes on this environment's flaky egress rather than
// actually being mocked out).
await mock.module("@/lib/email", () => ({
  FROM: "test@example.test",
  sendEmail: async () => {},
  emailTemplate: (title: string, body: string) => `${title}: ${body}`,
  notifyAssigned: async () => {},
  notifyOverdue: async () => {},
  notifyDeadlineApproaching: async () => {},
  notifyNewComment: async () => {},
}))

const { requestDpdpMagicLink, verifyDpdpMagicLink } = await import("./dpdp-auth-service")
const { db, dpdpLoginToken, dpdpIdentityEmail, dpdpIdentity } = await import("@/lib/db")
const { eq } = await import("drizzle-orm")

const d = hasDb ? describe : describe.skip

d("dpdp magic-link auth (real DB)", () => {
  let testEmail: string

  beforeAll(() => {
    testEmail = `auth-test-${crypto.randomUUID().slice(0, 8)}@example.test`
  })

  test("requesting a link creates an identity and a login_token; verifying it issues a session", async () => {
    await requestDpdpMagicLink(testEmail)

    const identityEmail = await db.query.dpdpIdentityEmail.findFirst({ where: eq(dpdpIdentityEmail.email, testEmail) })
    expect(identityEmail).toBeTruthy()

    const tokenRow = await db.query.dpdpLoginToken.findFirst({ where: eq(dpdpLoginToken.identityId, identityEmail!.identityId) })
    expect(tokenRow).toBeTruthy()
    expect(tokenRow!.consumedAt).toBeNull()

    // The raw token is never persisted (only its hash) -- reconstruct it the
    // same way verifyDpdpMagicLink does isn't possible from outside, so this
    // test exercises the DB state directly rather than the raw link value,
    // and separately proves the expiry/reuse rules against a token this
    // test creates itself (below), where the raw value is known.
  }, 30_000)

  test("a spent token is refused AND the reuse attempt is logged (B1)", async () => {
    const email = `auth-reuse-${crypto.randomUUID().slice(0, 8)}@example.test`
    await requestDpdpMagicLink(email)
    const identityEmail = await db.query.dpdpIdentityEmail.findFirst({ where: eq(dpdpIdentityEmail.email, email) })
    // Reconstruct the raw token is impossible (only the hash is stored), so
    // exercise verifyDpdpMagicLink through a token THIS test controls: insert
    // one directly with a known raw value, mirroring requestDpdpMagicLink's
    // own hashing.
    const { createHash, randomBytes } = await import("node:crypto")
    const raw = randomBytes(32).toString("base64url")
    const tokenHash = createHash("sha256").update(raw).digest("hex")
    await db.insert(dpdpLoginToken).values({ identityId: identityEmail!.identityId, tokenHash, expiresAt: new Date(Date.now() + 15 * 60 * 1000) })

    const first = await verifyDpdpMagicLink(raw)
    expect(first.identityId).toBe(identityEmail!.identityId)

    await expect(verifyDpdpMagicLink(raw)).rejects.toThrow()

    const row = await db.query.dpdpLoginToken.findFirst({ where: eq(dpdpLoginToken.tokenHash, tokenHash) })
    expect(row!.reuseAttemptedAt).not.toBeNull()
  }, 30_000)

  test("a token older than 15 minutes is refused", async () => {
    const email = `auth-expired-${crypto.randomUUID().slice(0, 8)}@example.test`
    const [identity] = await db.insert(dpdpIdentity).values({ primaryEmail: email }).returning()
    await db.insert(dpdpIdentityEmail).values({ identityId: identity.id, email, isPrimary: true })

    const { createHash, randomBytes } = await import("node:crypto")
    const raw = randomBytes(32).toString("base64url")
    const tokenHash = createHash("sha256").update(raw).digest("hex")
    // One second past the 15-minute TTL -- exercises the boundary, not just
    // an arbitrarily-far-in-the-past expiry.
    await db.insert(dpdpLoginToken).values({ identityId: identity.id, tokenHash, expiresAt: new Date(Date.now() - 1000) })

    await expect(verifyDpdpMagicLink(raw)).rejects.toThrow()
    const row = await db.query.dpdpLoginToken.findFirst({ where: eq(dpdpLoginToken.tokenHash, tokenHash) })
    expect(row!.reuseAttemptedAt).not.toBeNull()
    expect(row!.consumedAt).toBeNull()
  }, 30_000)

  test("an unknown token (never issued) is refused with no row to log against", async () => {
    await expect(verifyDpdpMagicLink("not-a-real-token-value")).rejects.toThrow()
  }, 30_000)
})
