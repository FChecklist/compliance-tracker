import type { GroupAnswerKind, ObligationRow, ViewerContext } from "@/lib/dpdp-onepage/view-model"
import type { DpdpClient, RpcError } from "./client"
import type {
  AiActionUndoPayload, AiDraftConfirmPayload, AiDraftPreviewPayload, AiLinkListItem, AiLinkPayload, AiLinkWarning, AiWorkLinkCreated,
  AreaAssignmentWire, AreaPayload, BillingStatusPayload, CaClientWire, ConfirmSetupPayload,
  CreateClientPayload, CreateMyOrgPayload, EmailActionPreview, EmailActionResult, FirstVisitPayload, GroupAnswerPayload, HistoryEntryWire, MyPagePayload,
  JoinOrgResult, OrgInviteLinkPayload, OrgSetupPayload, ParentConsentPreview, ParentConsentResult, ReferralCodePayload, ReferralSummaryPayload, SharePressPayload, UnsubscribeResult,
  ApprovePaymentResult, PendingClaimWire, RejectPaymentResult,
  AdminMarkPaidResult, AdminPartnerRow, AdminPartnerSettings, AdminPayoutRun, PartnerDashboardPayload, PartnerDetailsInput, PartnerStatementPayload, PartnerStatus,
} from "./rpc-types"
import { SITE_ORIGIN } from "./site-origin.mjs"

// Only reached from inside /app/ (never the public marketing surface --
// check-two-doors.mjs's own wall only scans publicSurfaceFiles(), which
// this module is not part of), so referencing the project's own
// functions/v1 URL directly here is safe.
const SUPABASE_FUNCTIONS_URL = `${(import.meta.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "")}/functions/v1`

export class RpcFailure extends Error {
  code?: string
  constructor(err: RpcError) {
    super(err.message)
    this.name = "RpcFailure"
    this.code = err.code
  }
}

export type MyPage = Omit<MyPagePayload, "rows"> & { rows: ObligationRow[] }

/** dpdp_my_page for the caller's newest membership, or for one org they belong to (the CA opening a client). */
export async function fetchMyPage(client: DpdpClient, orgId?: string | null): Promise<MyPage> {
  const { data, error } = await client.rpc("dpdp_my_page", orgId ? { p_org_id: orgId } : undefined)
  if (error) throw new RpcFailure(error)
  const page = data as MyPagePayload
  return { ...page, rows: page.rows.map((r) => ({ ...r, due: new Date(r.due) })) }
}

export async function markDone(client: DpdpClient, obligationId: string): Promise<void> {
  const { error } = await client.rpc("dpdp_mark_done", { p_obligation_id: obligationId })
  if (error) throw new RpcFailure(error)
}

export async function acknowledgeWelcome(client: DpdpClient, orgId?: string | null): Promise<void> {
  const { error } = await client.rpc("dpdp_acknowledge_welcome", orgId ? { p_org_id: orgId } : undefined)
  if (error) throw new RpcFailure(error)
}

export async function flagNotMe(client: DpdpClient, orgId?: string | null): Promise<void> {
  const { error } = await client.rpc("dpdp_flag_not_me", orgId ? { p_org_id: orgId } : undefined)
  if (error) throw new RpcFailure(error)
}

export function viewerContext(v: MyPagePayload["viewer"]): ViewerContext {
  return { kind: v.kind, me: v.email, caSub: v.caSub ?? undefined }
}

// ---------------------------------------------------------------------
// WO-DPDP-011 Step 3: the owner's page (drizzle/0605).
// ---------------------------------------------------------------------

export type Area = AreaPayload
export type AreaAssignment = AreaAssignmentWire
export type HistoryItem = Omit<HistoryEntryWire, "occurredAt"> & { occurredAt: Date }

/** areasForProduct(): the first-visit wizard's rows for this org's product. */
export async function fetchAreas(client: DpdpClient, product: "firm" | "institution"): Promise<Area[]> {
  const { data, error } = await client.rpc("dpdp_areas_for_product", { p_product: product })
  if (error) throw new RpcFailure(error)
  return data as Area[]
}

/** completeOwnerFirstVisit(): saves step 2's answers and stamps the owner's first visit. Owner-only. */
export async function completeOwnerFirstVisit(client: DpdpClient, orgId: string, assignments: AreaAssignment[]): Promise<FirstVisitPayload> {
  const { data, error } = await client.rpc("dpdp_complete_owner_first_visit", { p_org_id: orgId, p_assignments: assignments })
  if (error) throw new RpcFailure(error)
  return data as FirstVisitPayload
}

/** assignObligation() with the WO-011 §4 fix: the named person gets a membership too. Owner-only. */
export async function assignPerson(client: DpdpClient, obligationId: string, email: string): Promise<void> {
  const { error } = await client.rpc("dpdp_assign_person", { p_obligation_id: obligationId, p_email: email })
  if (error) throw new RpcFailure(error)
}

/** "Doesn't apply" for one job -- the owner or the person it's assigned to. */
export async function markNotApplicable(client: DpdpClient, obligationId: string, reason?: string): Promise<void> {
  const { error } = await client.rpc("dpdp_mark_not_applicable", { p_obligation_id: obligationId, p_reason: reason ?? null })
  if (error) throw new RpcFailure(error)
}

/** Change when one job is due (drizzle/0666). Owner-only; a finished or not-applicable job is refused; the date must be within 30 days back and 400 ahead. `dueOn` is YYYY-MM-DD. */
export async function setDueDate(client: DpdpClient, obligationId: string, dueOn: string): Promise<void> {
  const { error } = await client.rpc("dpdp_set_due_date", { p_obligation_id: obligationId, p_due_on: dueOn })
  if (error) throw new RpcFailure(error)
}

/** Add a note to one job's history (drizzle/0666): anyone who can see the job. 1-1000 characters; the history is append-only, so a note cannot be edited or removed. */
export async function addNote(client: DpdpClient, obligationId: string, text: string): Promise<void> {
  const { error } = await client.rpc("dpdp_add_note", { p_obligation_id: obligationId, p_text: text })
  if (error) throw new RpcFailure(error)
}

/** listOnePageHistory(): the org's events, newest first (the RPC caps at 50; the UI shows 15). */
export async function fetchHistory(client: DpdpClient, orgId?: string, limit = 15): Promise<HistoryItem[]> {
  const { data, error } = await client.rpc("dpdp_org_history", { p_limit: limit, ...(orgId ? { p_org_id: orgId } : {}) })
  if (error) throw new RpcFailure(error)
  return (data as HistoryEntryWire[]).map((h) => ({ ...h, occurredAt: new Date(h.occurredAt) }))
}

// ---------------------------------------------------------------------
// WO-DPDP-011 Step 5: the remaining WO-010 flows (drizzle/0609), the Step 4
// token pages (drizzle/0606) and the AI link (drizzle/0607).
// ---------------------------------------------------------------------

export type CaClient = CaClientWire

/** answerGroupObligation(): one member's private answer on a group job; the RPC rolls progress up and closes the job once everyone has answered. */
export async function answerGroup(client: DpdpClient, obligationId: string, answer: GroupAnswerKind): Promise<GroupAnswerPayload> {
  const { data, error } = await client.rpc("dpdp_answer_group", { p_obligation_id: obligationId, p_answer: answer })
  if (error) throw new RpcFailure(error)
  return data as GroupAnswerPayload
}

/** listCaClientOrgs(): every org where the caller is named CA partner/manager. Empty for everyone else. */
export async function fetchMyClients(client: DpdpClient): Promise<CaClient[]> {
  const { data, error } = await client.rpc("dpdp_my_clients")
  if (error) throw new RpcFailure(error)
  return data as CaClient[]
}

/** "+ Add a client" / "Set it up for them": a new client org with its jobs, the caller as CA partner, optionally the owner by email. */
export async function createClientOrg(client: DpdpClient, name: string, product: "firm" | "institution", ownerEmail?: string): Promise<CreateClientPayload> {
  const { data, error } = await client.rpc("dpdp_create_client_org", { p_name: name, p_product: product, p_owner_email: ownerEmail?.trim() || null })
  if (error) throw new RpcFailure(error)
  return data as CreateClientPayload
}

/** "Open my organisation": a signed-in visitor with no organisation opens their own and becomes its owner (drizzle/0654). referralCode (WO-DPDP-016, drizzle/0655) is the ?ref=<code> this visitor arrived with, if any -- a bad/unknown code is ignored server-side, never fails the signup. */
export async function createMyOrg(client: DpdpClient, name: string, product: "firm" | "institution", referralCode?: string | null): Promise<CreateMyOrgPayload> {
  const { data, error } = await client.rpc("dpdp_create_my_org", { p_name: name, p_product: product, p_referral_code: referralCode?.trim() || null })
  if (error) throw new RpcFailure(error)
  return data as CreateMyOrgPayload
}

/** Who set this org up, and whether its owner has confirmed -- decides the owner's first screen. */
export async function fetchOrgSetup(client: DpdpClient, orgId?: string | null): Promise<OrgSetupPayload> {
  const { data, error } = await client.rpc("dpdp_org_setup", orgId ? { p_org_id: orgId } : undefined)
  if (error) throw new RpcFailure(error)
  return data as OrgSetupPayload
}

/** "Looks right -- confirm": the owner's own act on a list their CA set up. Owner-only. */
export async function ownerConfirmSetup(client: DpdpClient, orgId?: string | null): Promise<ConfirmSetupPayload> {
  const { data, error } = await client.rpc("dpdp_owner_confirm_setup", orgId ? { p_org_id: orgId } : undefined)
  if (error) throw new RpcFailure(error)
  return data as ConfirmSetupPayload
}

/** dpdp_create_ai_link (0607): the token comes back exactly once; any previous live link is revoked. */
export async function createAiLink(client: DpdpClient, orgId?: string | null, ttlHours?: number): Promise<AiLinkPayload> {
  const { data, error } = await client.rpc("dpdp_create_ai_link", { ...(orgId ? { p_org_id: orgId } : {}), ...(ttlHours ? { p_ttl_hours: ttlHours } : {}) })
  if (error) throw new RpcFailure(error)
  return data as AiLinkPayload
}

/** The URL a person pastes into a chatbox: this host's /ai/<token>, which functions/ai/[token].ts serves as real text/html. */
export function aiLinkUrl(token: string): string {
  return `${SITE_ORIGIN}/ai/${token}`
}

/** dpdp_ai_draft_preview (0607): what a draft would do. The caller must be the draft's own membership. */
export async function aiDraftPreview(client: DpdpClient, draftId: string, confirmToken: string): Promise<AiDraftPreviewPayload> {
  const { data, error } = await client.rpc("dpdp_ai_draft_preview", { p_draft_id: draftId, p_confirm_token: confirmToken })
  if (error) throw new RpcFailure(error)
  return data as AiDraftPreviewPayload
}

/** dpdp_confirm_ai_draft (0607): the one place a draft takes effect, under the signed-in person's own authority. */
export async function confirmAiDraft(client: DpdpClient, draftId: string, confirmToken: string): Promise<AiDraftConfirmPayload> {
  const { data, error } = await client.rpc("dpdp_confirm_ai_draft", { p_draft_id: draftId, p_confirm_token: confirmToken })
  if (error) throw new RpcFailure(error)
  return data as AiDraftConfirmPayload
}

// ---------------------------------------------------------------------
// WO-DPDP-013 Part 1: the AI WORK link (drizzle/0610). The Copy-AI-link
// screen (WO-013 §4 item 6, a separate work item) consumes these.
// ---------------------------------------------------------------------

/** The numbers for the warning sentence shown BEFORE "Copy link": "<jobs> jobs and the names and emails of <people> people". */
export async function aiLinkWarning(client: DpdpClient, orgId?: string | null): Promise<AiLinkWarning> {
  const { data, error } = await client.rpc("dpdp_ai_link_warning", orgId ? { p_org_id: orgId } : undefined)
  if (error) throw new RpcFailure(error)
  return data as AiLinkWarning
}

/** "Copy AI link": level 0 (read, analyse, report) or 1 (small edits, directly); other people's emails hidden or not; lasts 1, 7 or 30 days. The token comes back exactly once. */
export async function createAiWorkLink(
  client: DpdpClient, opts: { level?: 0 | 1; hideEmails?: boolean; days?: 1 | 7 | 30; label?: string | null; orgId?: string | null } = {},
): Promise<AiWorkLinkCreated> {
  const { data, error } = await client.rpc("dpdp_ai_link_create", {
    p_level: opts.level ?? 0,
    p_hide_emails: opts.hideEmails ?? false,
    p_days: opts.days ?? 7,
    p_label: opts.label?.trim() || null,
    ...(opts.orgId ? { p_org_id: opts.orgId } : {}),
  })
  if (error) throw new RpcFailure(error)
  return data as AiWorkLinkCreated
}

/** "Your AI links": every link this person made in this org, newest first. */
export async function listAiLinks(client: DpdpClient, orgId?: string | null): Promise<AiLinkListItem[]> {
  const { data, error } = await client.rpc("dpdp_ai_link_list", orgId ? { p_org_id: orgId } : undefined)
  if (error) throw new RpcFailure(error)
  return data as AiLinkListItem[]
}

/** Revoke one link; effective on the AI's next call. The link's own person or the owner. Idempotent. */
export async function revokeAiLink(client: DpdpClient, linkId: string): Promise<void> {
  const { error } = await client.rpc("dpdp_ai_link_revoke", { p_id: linkId })
  if (error) throw new RpcFailure(error)
}

/** `/app/#undo=<actionId>.<token>` (POST /actions' undoUrl, later the Monday email): undo one Level 1 change within 24 hours, under the signed-in person's own authority. */
export async function undoAiAction(client: DpdpClient, actionId: string, undoToken: string): Promise<AiActionUndoPayload> {
  const { data, error } = await client.rpc("dpdp_ai_action_undo", { p_action_id: actionId, p_undo_token: undoToken })
  if (error) throw new RpcFailure(error)
  return data as AiActionUndoPayload
}

export type UndoFragment = { actionId: string; undoToken: string }

/** `/app/#undo=<actionId>.<token>`: read once on load and cleared, exactly as readDraftFragment does. */
export function readUndoFragment(): UndoFragment | null {
  const m = /^#undo=([^.&]+)\.([^&]+)$/.exec(window.location.hash)
  if (!m) return null
  window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search)
  return { actionId: decodeURIComponent(m[1]), undoToken: decodeURIComponent(m[2]) }
}

export type DraftFragment = { draftId: string; confirmToken: string }

/**
 * `/app/#draft=<draftId>.<confirmToken>` (the Edge Function's draftUrl): read
 * once on load and cleared with history.replaceState so the confirm token
 * never stays in the address bar or history. A hash that is not a draft
 * (the magic link's #access_token=..., or nothing) is left alone.
 */
export function readDraftFragment(): DraftFragment | null {
  const m = /^#draft=([^.&]+)\.([^&]+)$/.exec(window.location.hash)
  if (!m) return null
  window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search)
  return { draftId: decodeURIComponent(m[1]), confirmToken: decodeURIComponent(m[2]) }
}

/** The opaque token the Monday email / consent email put in the URL fragment (`/act/#<token>`). Never in the path or query. */
export function readFragmentToken(): string | null {
  const raw = window.location.hash.replace(/^#/, "")
  if (!raw) return null
  const m = /^(?:t|token)=(.+)$/.exec(raw)
  return decodeURIComponent(m ? m[1] : raw)
}

// The three token functions answer { ok:false, reason } rather than raising
// (drizzle/0606's own convention), so a PostgREST error here is a real
// transport/deployment problem, not a refusal.

/** What pressing the button on the /act/ page would do. Zero writes. */
export async function previewEmailAction(client: DpdpClient, token: string): Promise<EmailActionPreview> {
  const { data, error } = await client.rpc("dpdp_preview_email_action", { p_token: token })
  if (error) throw new RpcFailure(error)
  return data as EmailActionPreview
}

/** The button: spends the token and writes exactly what the in-app path writes. */
export async function applyEmailAction(client: DpdpClient, token: string, answer: GroupAnswerKind): Promise<EmailActionResult> {
  const { data, error } = await client.rpc("dpdp_apply_email_action", { p_token: token, p_answer: answer })
  if (error) throw new RpcFailure(error)
  return data as EmailActionResult
}

/** Stops the weekly email for that address; statutory notices continue. */
export async function unsubscribe(client: DpdpClient, token: string): Promise<UnsubscribeResult> {
  const { data, error } = await client.rpc("dpdp_unsubscribe", { p_token: token })
  if (error) throw new RpcFailure(error)
  return data as UnsubscribeResult
}

// ---------------------------------------------------------------------
// WO-DPDP-014 §3/§7: the share action (drizzle/0611).
// ---------------------------------------------------------------------

/** The caller's own referral code for `?ref=` on the public site -- decision-makers only (the RPC refuses everyone else with 42501). */
export async function myReferralCode(client: DpdpClient, orgId?: string | null): Promise<ReferralCodePayload> {
  const { data, error } = await client.rpc("dpdp_my_referral_code", orgId ? { p_org_id: orgId } : undefined)
  if (error) throw new RpcFailure(error)
  return data as ReferralCodePayload
}

/** One share_press event for WO-014 §7's "share presses per week, by role". Nothing about the person goes into it. */
export async function recordSharePress(client: DpdpClient, orgId?: string | null): Promise<SharePressPayload> {
  const { data, error } = await client.rpc("dpdp_record_share_press", orgId ? { p_org_id: orgId } : undefined)
  if (error) throw new RpcFailure(error)
  return data as SharePressPayload
}

// ---------------------------------------------------------------------
// WO-DPDP-016 §5: "refer and earn" -- the referrer's own view of what
// their code has earned (drizzle/0655). Any signed-in identity, matching
// the same "every email" widening dpdp__share_role got.
// ---------------------------------------------------------------------

/** This person's own code (null if they've never pressed Share / asked for one yet) and what it has earned so far. */
export async function myReferralSummary(client: DpdpClient, orgId?: string | null): Promise<ReferralSummaryPayload> {
  const { data, error } = await client.rpc("dpdp_my_referral_summary", orgId ? { p_org_id: orgId } : undefined)
  if (error) throw new RpcFailure(error)
  return data as ReferralSummaryPayload
}

// ---------------------------------------------------------------------
// WO-DPDP-016 Step 2: invite a colleague into MY organisation (drizzle/
// 0657) -- separate from the referral code above, which refers an entirely
// different firm for the revenue-share programme.
// ---------------------------------------------------------------------

/** Any member's own evergreen join code for `?join=` on the public site (lazily issued, same shape as the referral code). */
export async function myOrgInviteLink(client: DpdpClient, orgId?: string | null): Promise<OrgInviteLinkPayload> {
  const { data, error } = await client.rpc("dpdp_my_org_invite_link", orgId ? { p_org_id: orgId } : undefined)
  if (error) throw new RpcFailure(error)
  return data as OrgInviteLinkPayload
}

/** Redeems a `?join=` code: adds the CALLER to that code's organisation as staff. Idempotent if they already belong to it. */
export async function joinOrgViaInvite(client: DpdpClient, code: string): Promise<JoinOrgResult> {
  const { data, error } = await client.rpc("dpdp_join_org_via_invite", { p_code: code })
  if (error) throw new RpcFailure(error)
  return data as JoinOrgResult
}

// ---------------------------------------------------------------------
// WO-DPDP-016 §7-8: billing status for the owner's own page (drizzle/0655).
// Owner-only; access never depends on any of this.
// ---------------------------------------------------------------------

/** trial | awaiting_confirmation | active, plus the trial deadline and whatever the owner has claimed/the Owner has actually confirmed. */
export async function myBilling(client: DpdpClient, orgId?: string | null): Promise<BillingStatusPayload> {
  const { data, error } = await client.rpc("dpdp_my_billing", orgId ? { p_org_id: orgId } : undefined)
  if (error) throw new RpcFailure(error)
  return data as BillingStatusPayload
}

/** "I've paid": a claim, not a fact -- moves the org to awaiting_confirmation. Changes no access anywhere; the Owner still has to confirm the money was actually seen. reference/proofPath/note are all optional (drizzle/0658). */
export async function declarePayment(
  client: DpdpClient, interval: "month" | "year", amountPaise: number, orgId?: string | null,
  proof?: { reference?: string; proofPath?: string; note?: string },
): Promise<{ ok: true; state: "awaiting_confirmation" }> {
  const { data, error } = await client.rpc("dpdp_declare_payment", {
    p_interval: interval, p_amount_paise: amountPaise, ...(orgId ? { p_org_id: orgId } : {}),
    p_reference: proof?.reference || null, p_proof_path: proof?.proofPath || null, p_note: proof?.note || null,
  })
  if (error) throw new RpcFailure(error)
  return data as { ok: true; state: "awaiting_confirmation" }
}

/** Upload the payment-proof screenshot to Storage before declaring the payment (drizzle/0658's bucket). Returns null on failure -- the reference number alone still gets recorded. */
export async function uploadPaymentProof(client: DpdpClient, orgId: string, file: File): Promise<string | null> {
  const { path } = await client.uploadPaymentProof(orgId, file)
  return path
}

/** dpdp__is_platform_admin: whether the signed-in person is VERIDIAN's own team, not any one org's owner. Used only to decide whether to render the admin review panel at all. */
export async function amIPlatformAdmin(client: DpdpClient): Promise<boolean> {
  const { data, error } = await client.rpc("dpdp__is_platform_admin", {})
  if (error) return false
  return data === true
}

/** dpdp_owner_pending_claims: every organisation awaiting confirmation, across the whole platform. Owner only. */
export async function ownerPendingClaims(client: DpdpClient): Promise<PendingClaimWire[]> {
  const { data, error } = await client.rpc("dpdp_owner_pending_claims", {})
  if (error) throw new RpcFailure(error)
  return (data as PendingClaimWire[] | null) ?? []
}

/** dpdp_owner_approve_payment: the Owner's real act -- flips the org active, records the payment, pays out any referral commission. */
export async function ownerApprovePayment(client: DpdpClient, orgId: string, note?: string): Promise<ApprovePaymentResult> {
  const { data, error } = await client.rpc("dpdp_owner_approve_payment", { p_org_id: orgId, p_note: note || null })
  if (error) throw new RpcFailure(error)
  return data as ApprovePaymentResult
}

/** dpdp_owner_reject_payment: sends the org back to a plain trial and clears the claim. */
export async function ownerRejectPayment(client: DpdpClient, orgId: string, note?: string): Promise<RejectPaymentResult> {
  const { data, error } = await client.rpc("dpdp_owner_reject_payment", { p_org_id: orgId, p_note: note || null })
  if (error) throw new RpcFailure(error)
  return data as RejectPaymentResult
}

/** Fires the invoice email (supabase/functions/dpdp-invoice-email) right after approval. Best-effort: a failure here never undoes the approval -- the Owner can re-send from the same row (idempotent per paymentId). */
export async function sendInvoiceEmail(client: DpdpClient, paymentId: string): Promise<{ ok: boolean; error?: string }> {
  const token = await client.accessToken()
  if (!token) return { ok: false, error: "Not signed in" }
  try {
    const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/dpdp-invoice-email`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ paymentId }),
    })
    const body = await res.json().catch(() => ({}))
    return res.ok ? { ok: true } : { ok: false, error: (body as { error?: string }).error || `HTTP ${res.status}` }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** resolveConsentToken(): the parent consent page before any answer. */
export async function previewParentConsent(client: DpdpClient, token: string): Promise<ParentConsentPreview> {
  const { data, error } = await client.rpc("dpdp_parent_consent_preview", { p_token: token })
  if (error) throw new RpcFailure(error)
  return data as ParentConsentPreview
}

// ---------------------------------------------------------------------
// Sales Partner lifecycle (drizzle/0674).
// ---------------------------------------------------------------------

/** The partner's dashboard: status, masked payout details, funnel counts, money, lines. Any signed-in person. */
export async function partnerDashboard(client: DpdpClient): Promise<PartnerDashboardPayload> {
  const { data, error } = await client.rpc("dpdp_partner_dashboard")
  if (error) throw new RpcFailure(error)
  return data as PartnerDashboardPayload
}

/** Accept the partner terms (the version being shown). Creates the partner profile as "applied". */
export async function partnerAcceptTerms(client: DpdpClient, version: string, displayName?: string): Promise<{ ok: true; status: PartnerStatus; activated: boolean }> {
  const { data, error } = await client.rpc("dpdp_partner_accept_terms", { p_version: version, p_display_name: displayName?.trim() || null })
  if (error) throw new RpcFailure(error)
  return data as { ok: true; status: PartnerStatus; activated: boolean }
}

/** Save payout details (UPI id, or bank account). Never read back in full by the partner. */
export async function partnerSavePayoutDetails(client: DpdpClient, d: PartnerDetailsInput): Promise<{ ok: true; status: PartnerStatus; activated: boolean }> {
  const { data, error } = await client.rpc("dpdp_partner_save_payout_details", {
    p_method: d.method, p_upi_id: d.upiId?.trim() || null, p_account_name: d.accountName?.trim() || null,
    p_account_number: d.accountNumber?.trim() || null, p_ifsc: d.ifsc?.trim() || null, p_pan: d.pan?.trim() || null,
  })
  if (error) throw new RpcFailure(error)
  return data as { ok: true; status: PartnerStatus; activated: boolean }
}

/** The active partner's personal code (the same one the Share button hands out). */
export async function partnerGetCode(client: DpdpClient): Promise<{ code: string }> {
  const { data, error } = await client.rpc("dpdp_partner_get_code")
  if (error) throw new RpcFailure(error)
  return data as { code: string }
}

/** One month's statement, "YYYY-MM". */
export async function partnerStatement(client: DpdpClient, period: string): Promise<PartnerStatementPayload> {
  const { data, error } = await client.rpc("dpdp_partner_statement", { p_period: period })
  if (error) throw new RpcFailure(error)
  return data as PartnerStatementPayload
}

export async function adminPartnerSettings(client: DpdpClient): Promise<AdminPartnerSettings> {
  const { data, error } = await client.rpc("dpdp_admin_partner_settings")
  if (error) throw new RpcFailure(error)
  return data as AdminPartnerSettings
}

/** Any field left undefined is left as it was. Passing tdsPercent (0 included) marks the rate as set. */
export async function adminPartnerSetSettings(
  client: DpdpClient, s: { payableAfterDays?: number; payoutDay?: number; minPayoutPaise?: number; tdsPercent?: number },
): Promise<AdminPartnerSettings> {
  const { data, error } = await client.rpc("dpdp_admin_partner_set_settings", {
    p_payable_after_days: s.payableAfterDays ?? null, p_payout_day: s.payoutDay ?? null,
    p_min_payout_paise: s.minPayoutPaise ?? null, p_tds_percent: s.tdsPercent ?? null,
  })
  if (error) throw new RpcFailure(error)
  return data as AdminPartnerSettings
}

export async function adminPartnerList(client: DpdpClient): Promise<AdminPartnerRow[]> {
  const { data, error } = await client.rpc("dpdp_admin_partner_list")
  if (error) throw new RpcFailure(error)
  return (data as AdminPartnerRow[] | null) ?? []
}

export async function adminPartnerSetStatus(client: DpdpClient, identityId: string, status: "active" | "paused" | "ended", reason?: string): Promise<void> {
  const { error } = await client.rpc("dpdp_admin_partner_set_status", { p_identity_id: identityId, p_status: status, p_reason: reason ?? null })
  if (error) throw new RpcFailure(error)
}

/** The monthly payout run (read only). period "YYYY-MM"; omit for the month before this one. */
export async function adminPartnerPayoutRun(client: DpdpClient, period?: string): Promise<AdminPayoutRun> {
  const { data, error } = await client.rpc("dpdp_admin_partner_payout_run", { p_period: period ?? null })
  if (error) throw new RpcFailure(error)
  return data as AdminPayoutRun
}

/** After the money has been sent: records the UTR / reference and flips the commissions to paid. */
export async function adminPartnerMarkPaid(client: DpdpClient, period: string, identityId: string, reference: string, note?: string): Promise<AdminMarkPaidResult> {
  const { data, error } = await client.rpc("dpdp_admin_partner_mark_paid", { p_period: period, p_identity_id: identityId, p_reference: reference, p_note: note ?? null })
  if (error) throw new RpcFailure(error)
  return data as AdminMarkPaidResult
}

/** Asks the partner-mail function to send what is waiting (best effort; the cron does it every 30 minutes anyway). */
export async function flushPartnerEmails(client: DpdpClient): Promise<{ ok: boolean; error?: string }> {
  const token = await client.accessToken()
  if (!token) return { ok: false, error: "Not signed in" }
  try {
    const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/dpdp-partner-email`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ job: "flush" }),
    })
    const body = await res.json().catch(() => ({}))
    return res.ok ? { ok: true } : { ok: false, error: (body as { error?: string }).error || `HTTP ${res.status}` }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** recordConsent(): Yes or No -- both are answers, both are recorded. Single use. */
export async function parentConsent(client: DpdpClient, token: string, answer: "yes" | "no"): Promise<ParentConsentResult> {
  const { data, error } = await client.rpc("dpdp_parent_consent", { p_token: token, p_answer: answer })
  if (error) throw new RpcFailure(error)
  return data as ParentConsentResult
}
