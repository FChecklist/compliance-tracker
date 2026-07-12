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
