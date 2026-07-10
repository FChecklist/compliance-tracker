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
// Composio holds the actual OAuth tokens; this app only ever stores the
// connection's id/status/display email (compliance.connector_accounts),
// same "never store the secret itself" posture as encrypted BYO API keys
// elsewhere in this codebase -- except here there's nothing to encrypt at
// all, because there's nothing to store.

export type ConnectorToolkit =
  | "gmail"
  | "googledrive"
  | "googlecalendar"
  | "outlook"
  | "one_drive"
  | "share_point"
  | "microsoft_teams"
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
  outlook: { label: "Outlook", authConfigId: "ac_kKvzM35TBHyt" },
  one_drive: { label: "OneDrive", authConfigId: "ac_ppU_m75Q_oBZ" },
  share_point: { label: "SharePoint", authConfigId: "ac_dur2U8N5TO3b" },
  microsoft_teams: { label: "Microsoft Teams", authConfigId: "ac_SXconMw9Z474" },
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
