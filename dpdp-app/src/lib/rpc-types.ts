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
}
export type ParentConsentResult = TokenRefusal | { ok: true; answer: "yes" | "no" }

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
