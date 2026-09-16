/// <reference types="bun-types" />
// WO-DPDP-002 Section 4.1 (Principal test row): "All four journeys complete
// end to end with no account, on a fresh token."
//
// What's actually built (checked directly): ONE generic consent-token
// journey (dpdp.consent_token via dpdp-principal-service.ts), not four
// differentiated customer/employee/parent/vendor variants --
// dpdp.principal_group.label is freeform text, not a typed journey kind,
// and nothing branches on it. Building four differentiated flows (the
// veridian-complete.html spec gives each its own copy, and the parent
// variant carries real Section 9 legal weight) is a genuine, separate
// feature-design task, not something to bolt on inside a testing pass --
// flagged here rather than silently built or silently skipped. This test
// covers the ONE real journey thoroughly and for real: send a campaign,
// resolve the token (never a session), record consent (grant + withdraw
// both go through the same path, matching "taking permission away is as
// easy as giving it"), and raise a rights-request off the same token's org.
//
// Real database, real @/lib/email mock (fully synthetic, defined before any
// import -- see dpdp-auth-service.test.ts's own comment on why "import
// real then remock" doesn't reliably intercept a network call). Requires
// DATABASE_URL; skips cleanly if unset.
import { beforeAll, describe, expect, mock, test } from "bun:test"

await mock.module("@/lib/email", () => ({
  FROM: "test@example.test",
  sendEmail: async () => {},
  emailTemplate: (title: string, body: string) => `${title}: ${body}`,
  notifyAssigned: async () => {},
  notifyOverdue: async () => {},
  notifyDeadlineApproaching: async () => {},
  notifyNewComment: async () => {},
}))

const { sendConsentCampaign, resolveConsentToken, recordConsent, raiseRightsRequest } = await import("./dpdp-principal-service")
const { db, dpdpNoticeVersion, dpdpOrganisation, dpdpPrincipalGroup } = await import("@/lib/db")
const { withDpdpContext } = await import("@/lib/db/tenant-scoped")

const hasDb = !!process.env.DATABASE_URL
const d = hasDb ? describe : describe.skip

d("dpdp principal (Data Principal) journey -- the one real variant, end to end", () => {
  let orgId: string
  let groupId: string
  let noticeVersionId: string

  beforeAll(async () => {
    if (!hasDb) return
    const suffix = crypto.randomUUID().slice(0, 8)
    const [org] = await db.insert(dpdpOrganisation).values({ name: `Principal Test Org ${suffix}`, slug: `principal-test-${suffix}` }).returning()
    orgId = org.id
    await withDpdpContext({ orgId }, async (tx) => {
      const [group] = await tx.insert(dpdpPrincipalGroup).values({ orgId, label: "Customers" }).returning()
      groupId = group.id
      const [notice] = await tx
        .insert(dpdpNoticeVersion)
        .values({ orgId, docKind: "privacy_notice", version: "1.0", releasedOn: new Date().toISOString().slice(0, 10), effectiveFrom: new Date() })
        .returning()
      noticeVersionId = notice.id
    })
  }, 30_000)

  test("send -> open -> consent -> withdraw -> rights request, no account at any point", async () => {
    if (!hasDb) return

    const { sent } = await sendConsentCampaign({
      orgId, actorIdentityId: "test-owner-identity", groupId, noticeVersionId, contacts: ["principal-journey-test@example.test"],
    })
    expect(sent).toBe(1)

    // The raw token only ever exists in the (mocked) email -- recover it the
    // only way a real click could, by reading back the row
    // sendConsentCampaign just created (the token column IS the raw value
    // here, not a hash -- see dpdp-principal-service.ts's own
    // newOpaqueToken()). This org has exactly one campaign/token at this
    // point in the test, so the most recent row is unambiguous.
    const { dpdpConsentToken } = await import("@/lib/db")
    const { eq } = await import("drizzle-orm")
    const campaignTokens = await withDpdpContext({ orgId }, (tx) =>
      tx.query.dpdpConsentToken.findMany({ orderBy: (t, { desc }) => [desc(t.id)], limit: 1 }),
    )
    const raw = campaignTokens[0].token

    const opened = await resolveConsentToken(raw)
    expect(opened).toBeTruthy()
    expect(opened!.orgId).toBe(orgId)
    expect(opened!.notice!.id).toBe(noticeVersionId)

    const reOpened = await withDpdpContext({ orgId }, (tx) => tx.query.dpdpConsentToken.findFirst({ where: eq(dpdpConsentToken.token, raw) }))
    expect(reOpened!.openedAt).not.toBeNull()

    const granted = await recordConsent(raw, [{ purposeKey: "order", granted: true }, { purposeKey: "offers", granted: false }], "en")
    expect(granted).toHaveLength(2)
    expect(granted.find((r) => r.purposeKey === "order")!.granted).toBe(true)
    expect(granted.find((r) => r.purposeKey === "offers")!.withdrawnAt).not.toBeNull()

    // "Taking permission away is as easy as giving it" -- the exact same
    // token, same function, granted flips to false.
    const withdrawn = await recordConsent(raw, [{ purposeKey: "order", granted: false }], "en")
    expect(withdrawn[0].granted).toBe(false)
    expect(withdrawn[0].withdrawnAt).not.toBeNull()

    const request = await raiseRightsRequest({ orgId, kind: "delete", arrivedVia: "consent_token_link" })
    expect(request.ref).toMatch(/^R-\d{4}$/)
    expect(request.state).not.toBe("done")
  }, 30_000)

  test("an expired token resolves to null -- no account exists to fall back to", async () => {
    if (!hasDb) return
    const { dpdpConsentToken, dpdpConsentCampaign } = await import("@/lib/db")
    const [campaign] = await withDpdpContext({ orgId }, (tx) =>
      tx.insert(dpdpConsentCampaign).values({ orgId, groupId, noticeVersionId, sentAt: new Date() }).returning(),
    )
    const [expiredToken] = await withDpdpContext({ orgId }, (tx) =>
      tx.insert(dpdpConsentToken).values({ campaignId: campaign.id, token: crypto.randomUUID(), contactHash: "test", expiresAt: new Date(Date.now() - 1000) }).returning(),
    )
    const resolved = await resolveConsentToken(expiredToken.token)
    expect(resolved).toBeNull()
  }, 30_000)
})
