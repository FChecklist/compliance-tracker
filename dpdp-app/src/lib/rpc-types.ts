import type { GroupAnswerKind, ObligationRow } from "@/lib/dpdp-onepage/view-model"

// Wire shapes of the public.dpdp_* RPCs (WO-DPDP-011 Step 2 contract). The
// browser reaches the dpdp schema ONLY through these functions -- that
// schema is not exposed to PostgREST and 17 of its tables carry no RLS, so
// a direct supabase.from() against it would be a cross-tenant leak.

export type MyPageRowWire = Omit<ObligationRow, "due"> & { due: string }

export type ViewerKind = "owner" | "staff" | "go" | "coord" | "ca"

export type MyPagePayload = {
  org: { id: string; name: string; product: "firm" | "institution" }
  viewer: {
    email: string
    kind: ViewerKind
    caSub: "partner" | "manager" | null
    firstVisitSeenAt: string | null
    saidNotMeAt: string | null
    membershipId: string | null
  }
  rows: MyPageRowWire[]
}

export type OkPayload = { ok: true }

// WO-DPDP-011 Step 3 (drizzle/0605): the owner's RPCs.

/** One row of dpdp_areas_for_product -- the wizard's "who looks after what" table. */
export type AreaPayload = { area: string; jobs: string[]; isGroup: boolean }

/** One element of dpdp_complete_owner_first_visit's p_assignments. */
export type AreaAssignmentWire = { area: string; emails: string[]; na: boolean }

export type FirstVisitPayload = { ok: true; assigned: number; notApplicable: number }

/** One dpdp.event row as dpdp_org_history returns it (newest first). occurredAt is ISO-8601 UTC. */
export type HistoryEntryWire = { id: string; kind: string; summary: string; detail: string | null; actorLabel: string; occurredAt: string }

// WO-DPDP-011 Step 5 (drizzle/0609): the remaining WO-010 flows.

/** dpdp_answer_group: how many of the group have answered, and whether that closed the job. */
export type GroupAnswerPayload = { ok: true; answered: number; total: number; closed: boolean }

/** One row of dpdp_my_clients -- the CA firm view. whereItIs is the file's stage, dataLocations the data-map count. */
export type CaClientWire = {
  org: { id: string; name: string; product: "firm" | "institution" }
  caSub: "partner" | "manager"
  done: number
  total: number
  whereItIs: string
  dataLocations: number
  ownerConfirmedAt: string | null
  setUpByMe: boolean
}

/** dpdp_create_client_org: the new client org, its slug, how many jobs opened, the owner's membership if one was named. */
export type CreateClientPayload = { ok: true; orgId: string; slug: string; jobs: number; ownerMembershipId: string | null }

/** dpdp_create_my_org (drizzle/0654): a visitor's own new organisation; existing=true when a double click returned the one just made. */
export type CreateMyOrgPayload = { ok: true; orgId: string; slug: string; membershipId: string; jobs: number; existing: boolean }

/** dpdp_org_setup: who set this org up (null when the owner did), and whether the owner has confirmed. */
export type OrgSetupPayload = { orgId: string; setUpBy: { membershipId: string; email: string | null } | null; ownerConfirmedAt: string | null }

export type ConfirmSetupPayload = { ok: true; alreadyConfirmed: boolean }

/** The 0606 token functions answer { ok:false, reason } instead of raising -- the reason is the whole message. */
export type TokenRefusal = { ok: false; reason: string }

/** dpdp_preview_email_action (0606): what pressing the button on the /act/ page will do. */
export type EmailActionPreview = TokenRefusal | { ok: true; action: GroupAnswerKind; what: string | null; orgName: string | null; isGroup: boolean; alreadyDone: boolean }
export type EmailActionResult = TokenRefusal | { ok: true; obligationId: string; answer: GroupAnswerKind; what: string | null }
export type UnsubscribeResult = TokenRefusal | { ok: true; email: string }

/** dpdp_parent_consent_preview / dpdp_parent_consent (0609): the parent consent page. */
export type ParentConsentPreview = TokenRefusal | {
  ok: true
  orgName: string | null
  notice: { docKind: string; version: string; languages: string[] | null } | null
  openedAt: string | null
  actedAt: string | null
  alreadyAnswered: boolean
  // drizzle/0725 (all optional: a database that has not had it yet answers without them, and the page then behaves exactly as before)
  noticeText?: string
  noticeSource?: "organisation" | "standard"
  purposes?: ConsentPurpose[]
  principalIsChild?: boolean
  guardian?: { name: string; relation: "parent" | "legal_guardian" } | null
  canWithdraw?: boolean
}
/** One thing a consent link asks about, with the person's current answer. "withdrawn" = they said Yes and later withdrew. */
export type ConsentPurpose = { key: string; label: string; answer: "yes" | "no" | "withdrawn" | null }
export type ParentConsentResult = TokenRefusal | { ok: true; answer: "yes" | "no" }
/** dpdp_parent_consent_v2 / dpdp_consent_withdraw (drizzle/0725). */
export type ConsentAnswersResult = TokenRefusal | { ok: true; recorded: number }
export type ConsentWithdrawResult = TokenRefusal | { ok: true; withdrawn: string }

/** dpdp_create_ai_link (0607): the token is returned exactly once. */
export type AiLinkPayload = { linkId: string; token: string; expiresAt: string; revokedPrevious: number }

// WO-DPDP-013 Part 1 (drizzle/0610): the AI WORK link -- levels, the
// warning numbers, "Your AI links", undo. The token functions the Edge
// Function calls are service-role only and have no browser type here.

/** dpdp_ai_link_warning: the numbers in the sentence shown before "Copy link". */
export type AiLinkWarning = { jobs: number; people: number }

/** dpdp_ai_link_create(p_level 0|1, p_hide_emails, p_days 1|7|30, p_label): the token is returned exactly once, with the warning numbers. */
export type AiWorkLinkCreated = {
  linkId: string
  token: string
  level: 0 | 1
  hideEmails: boolean
  label: string | null
  expiresAt: string
  jobs: number
  people: number
}

/** One row of dpdp_ai_link_list -- "Your AI links", newest first, revoked/expired ones included (active=false). */
export type AiLinkListItem = {
  id: string
  label: string | null
  level: 0 | 1
  hideEmails: boolean
  createdAt: string
  expiresAt: string
  revokedAt: string | null
  lastUsedAt: string | null
  callCount: number
  active: boolean
}

/** dpdp_ai_action_undo(p_action_id, p_undo_token): `/app/#undo=<actionId>.<token>`. */
export type AiActionUndoPayload = { ok: true; verb: "NOTE" | "SET_DUE" | "ASSIGN" | "MARK_NA"; jobId: string }

/** The Level 2 verbs an AI may DRAFT (0610). The confirm screen executes only the ones marked so in DraftConfirm.tsx. */
export type AiLevel2Verb =
  | "MARK_DONE" | "OWNER_CONFIRM" | "MANAGER_CHECK" | "PARTNER_SIGN" | "DELETE" | "ADD_PERSON" | "REMOVE_PERSON" | "CHANGE_SIGNER" | "PUBLISH" | "EXPORT_PERSONAL_DATA"

export type AiDraftVerb = "ASSIGN" | "SET_DUE" | "NOTE" | "MARK_NA" | "DRAFT" | AiLevel2Verb

/** dpdp_ai_draft_preview (0607, verbs widened by 0610): what a draft would do if confirmed. */
export type AiDraftPreviewPayload = {
  draftId: string
  verb: AiDraftVerb
  obligationId: string | null
  job: string | null
  payload: Record<string, unknown>
  org: { id: string; name: string }
  createdAt: string
  expiresAt: string
  expired: boolean
  confirmedAt: string | null
}
export type AiDraftConfirmPayload = { ok: true; verb: string; obligationId: string | null }

// WO-DPDP-014 §3/§7 (drizzle/0611): the share action.

/** Who shares a referral code (WO-014 §3, widened WO-DPDP-016 §1): everyone gets a role now, 'member' being the default for anyone not owner/partner/manager. */
export type ShareRoleWire = "owner" | "partner" | "manager" | "member"

/** dpdp_my_referral_code: the caller's own dpdp.referral code (8 chars, unambiguous alphabet), made on first ask. Any signed-in member. */
export type ReferralCodePayload = { code: string; role: ShareRoleWire }

/** dpdp_record_share_press: one share_press event appended; the role it was recorded under. */
export type SharePressPayload = { ok: true; role: ShareRoleWire }

/** dpdp_my_referral_summary (drizzle/0655): this person's own code (null until they've asked for one) and what it has earned -- pending is not yet paid out, paid is what the Owner has already sent (both manual, outside this system). */
export type ReferralSummaryPayload = {
  code: string | null
  referredCount: number
  totalEarnedPaise: number
  pendingPaise: number
  paidPaise: number
}

/** dpdp_my_org_invite_link (drizzle/0657): this org's evergreen join code -- one per organisation, made on first ask, any member. */
export type OrgInviteLinkPayload = { code: string }

/** dpdp_join_org_via_invite (drizzle/0657): redeems a `?join=` code, adding the caller to that code's organisation as staff. alreadyMember is true when they belonged to it already (idempotent, not an error). */
export type JoinOrgResult = { ok: true; orgId: string; membershipId: string; alreadyMember: boolean }

/** dpdp_my_billing (drizzle/0655), owner-only: trial | awaiting_confirmation | active. selfDeclared* is the owner's own unverified claim; lastConfirmedAt is the only fact the Owner has actually verified. Access never depends on any of this. */
export type BillingStatusPayload = {
  orgId: string
  product: "firm" | "institution"
  state: "trial" | "awaiting_confirmation" | "active"
  trialEndsAt: string | null
  interval: "month" | "year" | null
  selfDeclaredAt: string | null
  selfDeclaredInterval: "month" | "year" | null
  selfDeclaredAmountPaise: number | null
  selfDeclaredReference: string | null
  selfDeclaredProofPath: string | null
  selfDeclaredNote: string | null
  lastConfirmedAt: string | null
}

// Payment confirmation flow (drizzle/0658), the Owner-only front door onto
// dpdp_record_confirmed_payment. dpdp__is_platform_admin gates all three.

/** dpdp_owner_pending_claims: every organisation currently awaiting confirmation, oldest first. */
export type PendingClaimWire = {
  orgId: string
  orgName: string
  product: "firm" | "institution"
  interval: "month" | "year" | null
  amountPaise: number | null
  reference: string | null
  proofPath: string | null
  note: string | null
  declaredAt: string | null
  ownerEmail: string | null
}

/** dpdp_owner_approve_payment: mirrors dpdp_record_confirmed_payment's own return shape. */
export type ApprovePaymentResult = { ok: true; paymentId: string; commissionId: string | null; commissionAmountPaise: number | null }
export type RejectPaymentResult = { ok: true; state: "trial" }

// ---------------------------------------------------------------------
// Sales Partner lifecycle (drizzle/0674). Counts and money only: no client name
// or personal data ever appears in these payloads. Payout details come back MASKED.
// ---------------------------------------------------------------------

export type PartnerStatus = "applied" | "active" | "paused" | "ended"

export type PartnerMaskedDetails = {
  method: "upi" | "bank"
  upiMasked: string | null
  nameMasked: string | null
  accountMasked: string | null
  ifscMasked: string | null
  panMasked: string | null
  updatedAt: string
}

export type PartnerLineWire = {
  at: string
  basis: "yearly" | "first_month"
  ratePercent: number
  grossPaise: number
  status: "waiting" | "payable" | "paid"
  payableOn: string
  paidOn: string | null
  /** For a paid line the final TDS; for others an estimate at the current rate, or null while the rate is not set. */
  tdsPaise: number | null
  netPaise: number | null
  tdsIsFinal: boolean
}

/** dpdp_partner_dashboard. `status` is null for a signed-in person who has not applied yet (only the first group of fields is then present). */
export type PartnerDashboardPayload = {
  status: PartnerStatus | null
  email: string
  currentTermsVersion: string
  needsTerms: boolean
  payableAfterDays: number
  payoutDay: number
  minPayoutPaise: number
  nextPayoutOn: string
  tdsPercentSet: boolean
  displayName?: string | null
  termsVersion?: string | null
  termsAcceptedAt?: string | null
  hasPayoutDetails?: boolean
  payoutDetails?: PartnerMaskedDetails | null
  code?: string | null
  funnel?: { signedUp: number; inTrial: number; paying: number; notCounted: number }
  money?: { earnedPaise: number; waitingPaise: number; payablePaise: number; paidGrossPaise: number; paidTdsPaise: number; paidNetPaise: number }
  lines?: PartnerLineWire[]
  payableBefore?: string
}

export type PartnerStatementLine = {
  madeOn: string
  basis: "yearly" | "first_month"
  ratePercent: number
  grossPaise: number
  tdsPaise: number | null
  netPaise: number | null
  status: "waiting" | "payable" | "paid"
  payableOn: string
  paidOn: string | null
}
export type PartnerStatementPayout = {
  paidOn: string; period: string; method: "upi" | "bank"; reference: string
  commissions: number; grossPaise: number; tdsPaise: number; netPaise: number
}
export type PartnerStatementPayload = {
  period: string
  email: string
  lines: PartnerStatementLine[]
  payouts: PartnerStatementPayout[]
  totals: { madePaise: number; paidGrossPaise: number; paidTdsPaise: number; paidNetPaise: number; stillWaitingPaise: number }
}

export type PartnerDetailsInput = {
  method: "upi" | "bank"
  upiId?: string
  accountName?: string
  accountNumber?: string
  ifsc?: string
  pan?: string
}

export type AdminPartnerSettings = {
  payableAfterDays: number; payoutDay: number; minPayoutPaise: number
  tdsPercent: number; tdsPercentSet: boolean; termsVersion: string; updatedAt: string
}

export type AdminPartnerRow = {
  identityId: string; email: string | null; name: string | null; status: PartnerStatus; termsVersion: string | null
  appliedAt: string; activatedAt: string | null; hasPayoutDetails: boolean
  signedUp: number; waitingPaise: number; payablePaise: number; paidNetPaise: number
}

/** The Owner's payout run. This is the ONE place full payout details are returned (to the Owner, who has to send the money). */
export type AdminPayoutPartner = {
  identityId: string; email: string | null; name: string | null; status: PartnerStatus
  method: "upi" | "bank"; upiId: string | null; accountName: string | null; accountNumber: string | null; ifsc: string | null; pan: string | null
  detailsUpdatedAt: string; detailsChangedRecently: boolean
  commissions: number; grossPaise: number; tdsPaise: number; netPaise: number; meetsMinimum: boolean
}
export type AdminPayoutRun = {
  period: string; payableBefore: string; tdsPercentSet: boolean; tdsPercent: number; minPayoutPaise: number; payoutDay: number
  partners: AdminPayoutPartner[]
  held: Array<{ identityId: string; email: string | null; grossPaise: number; reason: string }>
}
export type AdminMarkPaidResult = {
  ok: true; alreadyPaid: boolean; payoutId: string; netPaise: number
  email?: string | null; commissions?: number; grossPaise?: number; tdsPaise?: number
}
