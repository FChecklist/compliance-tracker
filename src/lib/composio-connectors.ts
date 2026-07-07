// Composio-backed one-click connectors: Gmail, Google Drive, Google
// Calendar. Auth configs (composio-managed OAuth2 clients, no Google Cloud
// project of our own needed) verified live 2026-07-07 against
// https://backend.composio.dev/api/v3 -- gmail and googledrive already
// existed from earlier work (content-pipeline credentials memory);
// googlecalendar's auth_config was created fresh in this same session.
//
// Composio holds the actual OAuth tokens; this app only ever stores the
// connection's id/status/display email (compliance.connector_accounts),
// same "never store the secret itself" posture as encrypted BYO API keys
// elsewhere in this codebase -- except here there's nothing to encrypt at
// all, because there's nothing to store.

export type ConnectorToolkit = "gmail" | "googledrive" | "googlecalendar"

export const CONNECTOR_TOOLKITS: Record<ConnectorToolkit, { label: string; authConfigId: string }> = {
  gmail: { label: "Gmail", authConfigId: "ac_011eZbN9n-gT" },
  googledrive: { label: "Google Drive", authConfigId: "ac_uUVUR8daHMpc" },
  googlecalendar: { label: "Google Calendar", authConfigId: "ac_dvAwoBTxv5Z6" },
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
