/// <reference types="bun-types" />
// WO-DPDP-002 Section 4.1 (Referral test row): pure-function coverage of the
// conflict rule. See dpdp-referral-service.integration.test.ts for the
// real-DB wrapper (recordReferralAttempt) that looks up membership/
// relationship rows before calling this.
import { describe, expect, test } from "bun:test"
import { decideReferralConflict } from "./dpdp-referral-service"

describe("decideReferralConflict", () => {
  test("blocks self-referral when the referrer already belongs to the referred org", () => {
    const reason = decideReferralConflict({
      referrerActiveOrgIds: ["org_referrer", "org_target"],
      referredOrgId: "org_target",
      advisoryRelationshipsFromReferrerOrgs: [],
    })
    expect(reason).toBe("self_referral")
  })

  test("blocks shared-advisor when a referrer org already advises the referred org", () => {
    const reason = decideReferralConflict({
      referrerActiveOrgIds: ["org_ca_firm"],
      referredOrgId: "org_existing_client",
      advisoryRelationshipsFromReferrerOrgs: [{ fromOrg: "org_ca_firm", toOrg: "org_existing_client" }],
    })
    expect(reason).toBe("shared_advisor")
  })

  test("self-referral takes priority when both would otherwise apply", () => {
    const reason = decideReferralConflict({
      referrerActiveOrgIds: ["org_x"],
      referredOrgId: "org_x",
      advisoryRelationshipsFromReferrerOrgs: [{ fromOrg: "org_x", toOrg: "org_x" }],
    })
    expect(reason).toBe("self_referral")
  })

  test("a genuine new introduction is not blocked", () => {
    const reason = decideReferralConflict({
      referrerActiveOrgIds: ["org_referrer"],
      referredOrgId: "org_brand_new_client",
      advisoryRelationshipsFromReferrerOrgs: [{ fromOrg: "org_referrer", toOrg: "org_some_other_client" }],
    })
    expect(reason).toBeNull()
  })

  test("an advisory relationship belonging to an unrelated org doesn't block", () => {
    const reason = decideReferralConflict({
      referrerActiveOrgIds: ["org_referrer"],
      referredOrgId: "org_target",
      advisoryRelationshipsFromReferrerOrgs: [{ fromOrg: "org_someone_else", toOrg: "org_target" }],
    })
    expect(reason).toBeNull()
  })
})
