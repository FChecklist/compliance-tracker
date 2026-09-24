import type { GroupAnswerKind, ObligationRow, ViewerContext } from "@/lib/dpdp-onepage/view-model"
import type { DpdpClient, RpcError } from "./client"
import type {
  AiActionUndoPayload, AiDraftConfirmPayload, AiDraftPreviewPayload, AiLinkListItem, AiLinkPayload, AiLinkWarning, AiWorkLinkCreated,
  AreaAssignmentWire, AreaPayload, CaClientWire, ConfirmSetupPayload,
  CreateClientPayload, EmailActionPreview, EmailActionResult, FirstVisitPayload, GroupAnswerPayload, HistoryEntryWire, MyPagePayload,
  OrgSetupPayload, ParentConsentPreview, ParentConsentResult, UnsubscribeResult,
} from "./rpc-types"
import { SITE_ORIGIN } from "./public-surface.mjs"

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

/** resolveConsentToken(): the parent consent page before any answer. */
export async function previewParentConsent(client: DpdpClient, token: string): Promise<ParentConsentPreview> {
  const { data, error } = await client.rpc("dpdp_parent_consent_preview", { p_token: token })
  if (error) throw new RpcFailure(error)
  return data as ParentConsentPreview
}

/** recordConsent(): Yes or No -- both are answers, both are recorded. Single use. */
export async function parentConsent(client: DpdpClient, token: string, answer: "yes" | "no"): Promise<ParentConsentResult> {
  const { data, error } = await client.rpc("dpdp_parent_consent", { p_token: token, p_answer: answer })
  if (error) throw new RpcFailure(error)
  return data as ParentConsentResult
}
