// Composio-backed one-click connectors. Auth configs (composio-managed
// OAuth2 clients, no Google Cloud / Microsoft Entra / etc. app of our own
// needed) verified live 2026-07-07 against https://backend.composio.dev/api/v3
// -- gmail and googledrive already existed from earlier work (content-
// pipeline credentials memory); googlecalendar's auth_config was created
// fresh that session.
//
// Wave (2026-07-10, Connectors.docx analysis): extended from 3 to 13
// toolkits. The founder's Connectors.docx proposed a from-scratch "Universal
// Connector" covering Microsoft 365 (Outlook/OneDrive/SharePoint/Teams) plus
// a long ecosystem-support table (Slack/Notion/GitHub/Dropbox/Box/
// Confluence/etc). Checked Composio's own toolkit catalog first, per the
// doc's own "don't duplicate what already exists" instruction -- every one
// of those toolkits already exists in Composio under composio-managed
// zero-setup OAuth (confirmed live via POST /auth_configs with
// {"type": "use_composio_managed_auth"} for each, same mechanism as the
// original 3), so building a bespoke Microsoft Graph client or bridging
// through the separate Activepieces MCP was unnecessary for the OAuth-
// connect layer -- this single map is the whole "Universal Connector" for
// authentication. (A normalization layer over what's actually pulled from
// each connected account -- turning connector data into Table/Document/
// Presentation/Communication business objects -- is separate, larger scope,
// not part of this wave.)
//
// Wave (2026-07-12, Priority-2 D26.B1.S1 verification): the source doc
// (ai-os/audit-tree/06-connectors.yaml, from Connectors.docx) names 8
// specific Microsoft apps + 7 specific Google apps for Layer 1, not just
// the 4 M365 apps above. Checked each of the other 11 against Composio's
// live toolkit catalog (GET /toolkits?search=..., confirmed 2026-07-12):
// - Google Sheets/Docs/Slides/Meet all exist as real, distinct Composio
//   toolkits (googlesheets/googledocs/googleslides/googlemeet), each with
//   composio_managed_auth_schemes: ["OAUTH2"] -- same zero-setup pattern.
//   Added below (auth_configs created live via the same POST /auth_configs
//   call as the original 13).
// - Microsoft Excel exists as a real, distinct Composio toolkit ("excel",
//   54 tools, its own Graph API surface for spreadsheet formulas/cells --
//   genuinely not covered by OneDrive/SharePoint's generic file storage).
//   Added below.
// - Microsoft Word and PowerPoint do NOT exist as Composio toolkits under
//   any slug tried (word/powerpoint/msword/microsoft_word/microsoftword/
//   office_word/ppt/microsoft_powerpoint all 404 "ToolkitNotFound"). Word
//   and PowerPoint documents are just files inside OneDrive/SharePoint in
//   Composio's model -- there is no separate Word/PowerPoint content API
//   the way Excel (cell/formula operations) and the Google apps each have
//   one. This is a genuine gap, not a naming miss: it cannot be closed the
//   same zero-setup way. Closing it would mean either (a) a bespoke
//   Microsoft Graph Word/PowerPoint client (the exact "build our own Graph
//   client" work this file's whole approach was chosen to avoid), or (b)
//   treating Word/PPT docs as opaque files reachable via the existing
//   OneDrive/SharePoint toolkits (no dedicated formula/slide-level access).
//   Left out of CONNECTOR_TOOLKITS; tracked in
//   ai-os/tree4-unified/50-completion-plan/07-priority2-tracker.yaml.
// - Outlook's existing toolkit already covers Microsoft Calendar (Composio
//   categorizes it under both "email" and "calendar", 286 tools) -- the
//   source doc's 8th Microsoft app ("Calendar") does not need a separate
//   toolkit/auth_config.
//
// Composio holds the actual OAuth tokens; this app only ever stores the
// connection's id/status/display email (compliance.connector_accounts),
// same "never store the secret itself" posture as encrypted BYO API keys
// elsewhere in this codebase -- except here there's nothing to encrypt at
// all, because there's nothing to store.

export type ConnectorToolkit =
  | "gmail"
  | "googledrive"
  | "googlecalendar"
  | "googlesheets"
  | "googledocs"
  | "googleslides"
  | "googlemeet"
  | "outlook"
  | "one_drive"
  | "share_point"
  | "microsoft_teams"
  | "excel"
  | "slack"
  | "notion"
  | "github"
  | "dropbox"
  | "box"
  | "confluence"

export const CONNECTOR_TOOLKITS: Record<ConnectorToolkit, { label: string; authConfigId: string }> = {
  gmail: { label: "Gmail", authConfigId: "ac_011eZbN9n-gT" },
  googledrive: { label: "Google Drive", authConfigId: "ac_uUVUR8daHMpc" },
  googlecalendar: { label: "Google Calendar", authConfigId: "ac_dvAwoBTxv5Z6" },
  googlesheets: { label: "Google Sheets", authConfigId: "ac_lfcfCz_JYKAU" },
  googledocs: { label: "Google Docs", authConfigId: "ac_uZmYCDkZ24w7" },
  googleslides: { label: "Google Slides", authConfigId: "ac_5qg7xRTilJ5K" },
  googlemeet: { label: "Google Meet", authConfigId: "ac_axUlQpTgpKnD" },
  outlook: { label: "Outlook", authConfigId: "ac_kKvzM35TBHyt" },
  one_drive: { label: "OneDrive", authConfigId: "ac_ppU_m75Q_oBZ" },
  share_point: { label: "SharePoint", authConfigId: "ac_dur2U8N5TO3b" },
  microsoft_teams: { label: "Microsoft Teams", authConfigId: "ac_SXconMw9Z474" },
  excel: { label: "Excel", authConfigId: "ac_jG5HX2qupKMa" },
  slack: { label: "Slack", authConfigId: "ac_BOgSMAMSoORm" },
  notion: { label: "Notion", authConfigId: "ac_GN6aDBKKh3EP" },
  github: { label: "GitHub", authConfigId: "ac_zFxYvOyW2Yvy" },
  dropbox: { label: "Dropbox", authConfigId: "ac_UHUf0Fng0sPv" },
  box: { label: "Box", authConfigId: "ac_qdy1WDdjl9Sh" },
  confluence: { label: "Confluence", authConfigId: "ac_Cs5ZoQuJ8frR" },
}

const COMPOSIO_BASE_URL = "https://backend.composio.dev/api/v3"

function apiKey(): string {
  const key = process.env.COMPOSIO_API_KEY
  if (!key) throw new Error("COMPOSIO_API_KEY is not configured.")
  return key
}

async function composioFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${COMPOSIO_BASE_URL}${path}`, {
    ...init,
    headers: { "x-api-key": apiKey(), "Content-Type": "application/json", ...(init?.headers ?? {}) },
  })
  if (!res.ok) throw new Error(`Composio API error (${path}): HTTP ${res.status} ${await res.text()}`)
  return res.json()
}

export type InitiateConnectionResult = {
  linkToken: string
  redirectUrl: string
  expiresAt: string
  connectedAccountId: string
}

/** Starts an OAuth flow for one toolkit. The caller opens `redirectUrl` (popup/new tab) for the user to complete. */
export async function initiateConnection(toolkit: ConnectorToolkit, appUserId: string): Promise<InitiateConnectionResult> {
  const { authConfigId } = CONNECTOR_TOOLKITS[toolkit]
  const data = await composioFetch("/connected_accounts/link", {
    method: "POST",
    body: JSON.stringify({ auth_config_id: authConfigId, user_id: appUserId }),
  })
  return {
    linkToken: data.link_token,
    redirectUrl: data.redirect_url,
    expiresAt: data.expires_at,
    connectedAccountId: data.connected_account_id,
  }
}

export type ConnectionStatus = "INITIALIZING" | "ACTIVE" | "FAILED" | "EXPIRED" | string

/** Polls Composio for a connected account's current status -- call after the user returns from the OAuth redirect. */
export async function getConnectionStatus(composioConnectedAccountId: string): Promise<{ status: ConnectionStatus; email?: string }> {
  const data = await composioFetch(`/connected_accounts/${composioConnectedAccountId}`)
  // Composio doesn't return a normalized "connected email" field uniformly
  // across toolkits -- best-effort extraction from whatever profile data is
  // present, falls back to undefined (UI shows "Connected" without an email).
  const email = data?.data?.email || data?.data?.emailAddress || undefined
  return { status: data.status, email }
}

// ─── Real tool execution (GAP-CONNECTOR-DATA / D26.B2.S1) ──────────────────
// Everything above this line only ever manages the OAuth connection itself
// (initiate / poll status) -- confirmed by direct grep before this wave: zero
// code anywhere in this codebase ever called Composio's tool-execution
// endpoint, meaning "connected" toolkits never actually pulled any real data
// (messages, files, ...) through the connection. This is that missing call.
//
// Endpoint confirmed live against Composio's v3 API docs (docs.composio.dev,
// "Execute tool" -- POST /api/v3/tools/execute/{tool_slug}) 2026-07-12:
// takes the tool slug in the path, and a body of { user_id, arguments,
// connected_account_id? }. Response envelope is Composio's standard
// { successful, data, error } shape (older SDKs/docs spell it "successfull"
// -- both are defended against here since this wasn't verified against a
// live call in this session, see connector-data-service.ts's own header for
// the same disclosed limitation).
export type ExecuteActionResult<T = unknown> = {
  successful: boolean
  data: T
  error: string | null
}

// ─── OAuth scope allow-list gate (CRR-158) ──────────────────────────────
// Owner ruling, 28 Aug 2026 (platform.claude_log id 127, "OWNER RULING 28
// AUG 2026: Google connectors (Mail, Drive, Sheets, Docs), per-user, read +
// edit + write. Extends R-C16, rewrites CRR-158, answers CRR-156"):
// connecting Google Mail/Drive/Sheets/Docs for every end user is approved
// with READ, EDIT and WRITE rights. This SUPERSEDES CRR-158's original
// read-only prohibition -- the ruling's own words: "THE CONTROL WAS
// REPLACED, NOT REMOVED: the gate now fails on any scope outside a recorded
// allow-list, on any delete scope, and on any write or edit action that
// produces no audit row."
//
// This is a validation/enforcement layer, not live Google OAuth enablement.
// CRR-007 (verify COMPOSIO_API_KEY) is BLOCKED -- provisioning it means
// paying for a Composio plan, and a Composio purchase is a standing
// DECLINED item (CRR-007). Nothing below has been exercised against a real
// Google account or a live Composio call this session; the allow-list
// scopes are Google's own publicly documented OAuth 2.0 scope URIs
// (developers.google.com scope reference), sourced from documentation the
// same way this file's other toolkit/auth_config facts above were
// originally recorded, not re-verified live in this session.
//
// Deliberately per-toolkit rather than one global list: Gmail/Drive/Sheets/
// Docs are the only 4 toolkits the ruling named. Every other toolkit in
// CONNECTOR_TOOLKITS above (Slack, Notion, GitHub, ...) has NO recorded
// allow-list -- evaluateToolkitScopes() below fails closed for those
// (nothing recorded = nothing permitted), matching the ruling's own
// "replaced, not removed" posture rather than silently permitting whatever
// scopes a not-yet-reviewed toolkit happens to request.
export type ScopeLevel = "read" | "edit" | "write"

export type ScopeAllowListEntry = {
  /** The exact OAuth 2.0 scope URI Google issues. */
  scope: string
  level: ScopeLevel
  description: string
}

export const GOOGLE_CONNECTOR_SCOPE_ALLOW_LIST: Partial<Record<ConnectorToolkit, ScopeAllowListEntry[]>> = {
  gmail: [
    { scope: "https://www.googleapis.com/auth/gmail.readonly", level: "read", description: "Read all resources and their metadata -- no write operations." },
    { scope: "https://www.googleapis.com/auth/gmail.modify", level: "edit", description: "All read/write operations except immediate, permanent deletion of threads and messages (moves to Trash instead)." },
    { scope: "https://www.googleapis.com/auth/gmail.labels", level: "edit", description: "Create, read, update, and delete labels only." },
    { scope: "https://www.googleapis.com/auth/gmail.compose", level: "write", description: "Create, read, update, and delete drafts; send messages and drafts." },
    { scope: "https://www.googleapis.com/auth/gmail.send", level: "write", description: "Send messages only -- no read/modify access." },
  ],
  googledrive: [
    { scope: "https://www.googleapis.com/auth/drive.readonly", level: "read", description: "See and download all Drive files." },
    { scope: "https://www.googleapis.com/auth/drive.metadata.readonly", level: "read", description: "See metadata (not content) for all Drive files." },
    { scope: "https://www.googleapis.com/auth/drive.file", level: "write", description: "Per-file access: create new files, and read/write only files this app opened or created -- deliberately NOT the unrestricted 'drive' scope, see KNOWN_DELETE_CAPABLE_SCOPES below." },
  ],
  googlesheets: [
    { scope: "https://www.googleapis.com/auth/spreadsheets.readonly", level: "read", description: "See all Google Sheets spreadsheets." },
    { scope: "https://www.googleapis.com/auth/spreadsheets", level: "edit", description: "See, edit and create Google Sheets spreadsheets (Google provides no narrower edit-only scope for Sheets) -- application code must never invoke a delete/trash action under this scope regardless of what it technically permits; see classifyConnectorActionCategory's 'delete' category, which this gate refuses unconditionally." },
  ],
  googledocs: [
    { scope: "https://www.googleapis.com/auth/documents.readonly", level: "read", description: "See all Google Docs documents." },
    { scope: "https://www.googleapis.com/auth/documents", level: "edit", description: "See, edit and create Google Docs documents. Deleting the underlying file requires a separate Drive scope, not granted here." },
  ],
}

// Scopes Google documents as granting full-account / permanent-delete
// capability well beyond read+edit+write. Flagged with their own violation
// type on ANY toolkit, unconditionally -- never eligible for an allow-list
// above no matter how this file is edited later, since "no delete scope" is
// its own, independent CRR-158 gate_fail condition, not merely "unlisted".
export const KNOWN_DELETE_CAPABLE_SCOPES: ReadonlySet<string> = new Set<string>([
  "https://mail.google.com/", // Gmail full-mailbox scope -- permanent delete, bypasses Trash
  "https://www.googleapis.com/auth/drive", // Drive full scope -- can permanently delete any file, not just app-created ones
])

export type ScopeViolationType =
  | "delete_scope"
  | "not_allow_listed"
  | "no_allow_list_recorded"
  | "write_action_missing_audit"

export type ScopeViolation = { type: ScopeViolationType; scope?: string; detail: string }

export type ScopeEvaluation = { toolkit: ConnectorToolkit; pass: boolean; violations: ScopeViolation[] }

/** Compares one toolkit's actually-requested/granted scopes against its recorded allow-list. Pure -- no network, no DB. */
export function evaluateToolkitScopes(toolkit: ConnectorToolkit, requestedScopes: string[]): ScopeEvaluation {
  const allowList = GOOGLE_CONNECTOR_SCOPE_ALLOW_LIST[toolkit]

  if (!allowList) {
    // Deny-by-default: no allow-list has been recorded/owner-approved for
    // this toolkit, so nothing is permitted for it yet -- not "anything
    // goes because nobody wrote a rule".
    const violations: ScopeViolation[] = requestedScopes.map((scope) => ({
      type: "no_allow_list_recorded",
      scope,
      detail: `No scope allow-list is recorded for '${toolkit}'. Every requested scope fails closed until one is written and owner-approved (see CRR-158).`,
    }))
    return { toolkit, pass: violations.length === 0, violations }
  }

  const allowedScopeStrings = new Set(allowList.map((e) => e.scope))
  const violations: ScopeViolation[] = []
  for (const scope of requestedScopes) {
    if (KNOWN_DELETE_CAPABLE_SCOPES.has(scope)) {
      violations.push({ type: "delete_scope", scope, detail: `'${scope}' grants permanent-delete/full-account capability -- never permitted, regardless of allow-list (CRR-158 gate_fail).` })
      continue
    }
    if (!allowedScopeStrings.has(scope)) {
      violations.push({ type: "not_allow_listed", scope, detail: `'${scope}' is not on the recorded allow-list for '${toolkit}'.` })
    }
  }
  return { toolkit, pass: violations.length === 0, violations }
}

export type ConnectorActionCategory = "read" | "write" | "edit" | "delete"

// Composio/Google action (tool) slugs are consistently verb-bearing
// SCREAMING_SNAKE_CASE (e.g. GMAIL_SEND_EMAIL, GOOGLEDRIVE_FIND_FILE,
// GOOGLESHEETS_BATCH_UPDATE) -- classified by keyword, checked most-
// destructive-first so e.g. "PERMANENTLY_DELETE" never falls through to the
// "delete" branch's own narrower siblings by accident.
const DELETE_ACTION_PATTERN = /(DELETE|TRASH|PURGE|REMOVE)/
const WRITE_ACTION_PATTERN = /(SEND|CREATE|COMPOSE|DRAFT|INSERT|APPEND|UPLOAD|ADD_)/
const EDIT_ACTION_PATTERN = /(UPDATE|MODIFY|EDIT|PATCH|RENAME|MOVE|REPLACE|SET_|LABEL)/

/** Classifies a Composio action slug into the category CRR-158's gate reasons about. Pure, keyword-based -- never calls Composio. */
export function classifyConnectorActionCategory(actionSlug: string): ConnectorActionCategory {
  const s = actionSlug.toUpperCase()
  if (DELETE_ACTION_PATTERN.test(s)) return "delete"
  if (WRITE_ACTION_PATTERN.test(s)) return "write"
  if (EDIT_ACTION_PATTERN.test(s)) return "edit"
  return "read"
}

/** The minimum a caller must supply for a write/edit action to be auditable -- the actor (who) is added by the real DB-writing wrapper in connector-scope-gate-service.ts, not needed for this pure gate decision. */
export type ConnectorAuditDescriptor = {
  orgId: string
  entityType: string
  entityId: string // the target file/message id
  details?: string
}

export type ConnectorGateVerdict = {
  toolkit: ConnectorToolkit
  actionSlug: string
  category: ConnectorActionCategory
  allowed: boolean
  violations: ScopeViolation[]
}

/**
 * The single pure CRR-158 gate decision -- combines the scope-vs-allow-list
 * check with the action being attempted. evaluateToolkitScopes() alone
 * can't see this: a connected account might hold only read scopes yet still
 * be asked to run a write action, or hold a legitimately-granted write scope
 * but the caller simply forgot to pass audit info. No network, no DB --
 * real execution (connector-scope-gate-service.ts) must call this FIRST and
 * refuse to call Composio at all when `allowed` is false.
 */
export function evaluateConnectorGate(params: {
  toolkit: ConnectorToolkit
  actionSlug: string
  requestedScopes: string[]
  audit?: ConnectorAuditDescriptor
}): ConnectorGateVerdict {
  const category = classifyConnectorActionCategory(params.actionSlug)
  const scopeEval = evaluateToolkitScopes(params.toolkit, params.requestedScopes)
  const violations: ScopeViolation[] = [...scopeEval.violations]

  if (category === "delete") {
    violations.push({
      type: "delete_scope",
      detail: `'${params.actionSlug}' is classified as a delete action -- CRR-158 forbids deleting customer data under any scope, independent of which scopes are granted.`,
    })
  } else if ((category === "write" || category === "edit") && !params.audit) {
    violations.push({
      type: "write_action_missing_audit",
      detail: `'${params.actionSlug}' is a ${category} action against a user's Google account and requires an audit descriptor (orgId, entityType, entityId) -- none was supplied, so this call is refused before Composio is ever invoked.`,
    })
  }

  return { toolkit: params.toolkit, actionSlug: params.actionSlug, category, allowed: violations.length === 0, violations }
}

/**
 * Live-fetches the scopes actually configured on a toolkit's auth_config
 * from Composio (GET /auth_configs/{id}) -- the "record the exact OAuth
 * scopes requested in auth_config" half of CRR-158. Defensive parsing
 * (several plausible response shapes) for the same disclosed reason
 * connector-data-service.ts's normalizers are: not verified against a live
 * call this session (COMPOSIO_API_KEY is not configured -- CRR-007 BLOCKED,
 * standing declined purchase). Callers should feed the result straight into
 * evaluateToolkitScopes()/evaluateConnectorGate() as `requestedScopes`.
 */
export async function getAuthConfigScopes(toolkit: ConnectorToolkit): Promise<string[]> {
  const { authConfigId } = CONNECTOR_TOOLKITS[toolkit]
  const data = await composioFetch(`/auth_configs/${authConfigId}`)
  const raw =
    data?.scopes ?? data?.data?.scopes ?? data?.auth_config?.scopes ?? data?.data?.auth_config?.scopes ?? []
  if (Array.isArray(raw)) return raw.map(String)
  if (typeof raw === "string") return raw.split(",").map((s) => s.trim()).filter(Boolean)
  return []
}

/**
 * Executes a real Composio tool/action against an already-connected account
 * -- e.g. GMAIL_FETCH_EMAILS, GOOGLEDRIVE_FIND_FILE. `appUserId` must be the
 * same id passed to initiateConnection() for this connection (dbUser.id in
 * every real caller), and `composioConnectedAccountId` should be the
 * specific connected account to run through (avoids ambiguity if a user
 * somehow has more than one connection for the same toolkit).
 */
export async function executeAction<T = unknown>(
  actionSlug: string,
  composioConnectedAccountId: string,
  appUserId: string,
  args: Record<string, unknown> = {}
): Promise<ExecuteActionResult<T>> {
  const data = await composioFetch(`/tools/execute/${actionSlug}`, {
    method: "POST",
    body: JSON.stringify({
      connected_account_id: composioConnectedAccountId,
      user_id: appUserId,
      arguments: args,
    }),
  })
  return {
    successful: data?.successful ?? data?.successfull ?? false,
    data: data?.data as T,
    error: data?.error ?? null,
  }
}
