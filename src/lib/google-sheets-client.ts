// R68 Phase 7 (Institutional Memory Graph, Google Sheets projection).
// Owner ruling, 2026-09-03: Supabase is canonical; Sheets is a ONE-WAY,
// write-through projection -- readable/shareable mirror only, no vectors,
// no write-back. See memory-sheets-projection.ts for the job that uses
// this client; that file's header carries the full reasoning.
//
// This is a deliberately dependency-free REST client, not a wrapper around
// the `googleapis` npm package -- this codebase has no existing googleapis
// or google-auth-library *runtime* dependency (grep confirms the only
// `googleapis.com` hits in the repo are Composio OAuth *scope strings* in
// composio-connectors.ts, not an SDK). Composio itself is explicitly out of
// scope for this phase (R-CRR-09 keeps it gated on a spend decision this
// session has no authority over) and would be the wrong tool anyway: this
// is a server-to-server output integration, not a per-user ingestion
// connector. Rather than adding a new dependency for one job, this signs
// its own service-account JWT with Node's built-in `crypto` and calls the
// Sheets v4 REST API directly with `fetch`.
//
// ─── Credentials (real env vars, never fabricated) ─────────────────────
//
//   GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON
//     The full JSON key file downloaded for a Google Cloud service account
//     (Sheets API enabled, and the target spreadsheet shared with the
//     service account's client_email as an Editor), as a single-line JSON
//     string. Must contain at least `client_email` and `private_key`.
//
//   GOOGLE_SHEETS_SPREADSHEET_ID
//     The target spreadsheet's id (the long token in its URL between
//     /d/ and /edit).
//
// Neither is set in this sandboxed environment -- see this repo's PR
// description / task report for what that means for live verification.
// isGoogleSheetsConfigured() is the single source of truth callers use to
// decide whether to run at all; nothing in this file throws when the env
// vars are absent, so a caller that checks it first never hits a network
// call it can't make.

type ServiceAccountKey = {
  client_email: string
  private_key: string
  token_uri?: string
}

function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function readServiceAccountKey(): ServiceAccountKey | null {
  const raw = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON
  if (!raw || !raw.trim()) return null
  try {
    const parsed = JSON.parse(raw) as Partial<ServiceAccountKey>
    if (!parsed.client_email || !parsed.private_key) return null
    return { client_email: parsed.client_email, private_key: parsed.private_key, token_uri: parsed.token_uri }
  } catch {
    return null
  }
}

/**
 * True only when both the service-account JSON and the target spreadsheet
 * id are present and the JSON at least parses into the shape this client
 * needs. Callers (the loop, its tests) must check this BEFORE calling
 * anything else here -- it is the "not configured, skip cleanly" gate.
 */
export function isGoogleSheetsConfigured(): boolean {
  return readServiceAccountKey() !== null && !!process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim()
}

export function getConfiguredSpreadsheetId(): string {
  const id = process.env.GOOGLE_SHEETS_SPREADSHEET_ID?.trim()
  if (!id) throw new Error("getConfiguredSpreadsheetId: GOOGLE_SHEETS_SPREADSHEET_ID is not set")
  return id
}

// Read-only scope would be pointless for a write-through projection, and
// there is no narrower Sheets write-only scope Google offers (same
// tradeoff composio-connectors.ts documents for its own spreadsheets
// scope) -- this uses the one edit scope, and this file only ever calls
// the `values.append` endpoint, never delete/clear.
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets"
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token"

async function signServiceAccountJwt(key: ServiceAccountKey): Promise<string> {
  const { createSign } = await import("node:crypto")
  const header = { alg: "RS256", typ: "JWT" }
  const now = Math.floor(Date.now() / 1000)
  const claims = {
    iss: key.client_email,
    scope: SHEETS_SCOPE,
    aud: key.token_uri ?? DEFAULT_TOKEN_URI,
    iat: now,
    exp: now + 3600,
  }
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`
  const signer = createSign("RSA-SHA256")
  signer.update(unsigned)
  signer.end()
  const signature = base64url(signer.sign(key.private_key))
  return `${unsigned}.${signature}`
}

let cachedToken: { accessToken: string; expiresAt: number } | null = null

async function getAccessToken(key: ServiceAccountKey): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.accessToken
  const jwt = await signServiceAccountJwt(key)
  const tokenUri = key.token_uri ?? DEFAULT_TOKEN_URI
  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  })
  if (!res.ok) {
    throw new Error(`getAccessToken: token exchange failed (${res.status}): ${await res.text().catch(() => "")}`)
  }
  const json = (await res.json()) as { access_token: string; expires_in: number }
  cachedToken = { accessToken: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 }
  return json.access_token
}

export type AppendRowsResult = {
  // The A1-notation range Sheets actually wrote to, e.g. "MemoryRecords!A12:I12"
  // for a single appended row, or "MemoryRecords!A12:I14" for three.
  updatedRange: string
  updatedRows: number
}

/**
 * Appends rows to the end of `sheetName`'s existing table (Sheets decides
 * the exact landing range via its own table-detection, same as pasting
 * below existing data) via `spreadsheets.values.append`. Never calls any
 * clear/delete/update-existing-cell endpoint -- append-only, matching this
 * job's one-way, additive design.
 */
export async function appendRows(sheetName: string, rows: string[][]): Promise<AppendRowsResult> {
  if (rows.length === 0) return { updatedRange: "", updatedRows: 0 }
  const key = readServiceAccountKey()
  if (!key) throw new Error("appendRows: Google Sheets is not configured (GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON unset/invalid)")
  const spreadsheetId = getConfiguredSpreadsheetId()
  const accessToken = await getAccessToken(key)

  const range = encodeURIComponent(`${sheetName}!A1`)
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: rows }),
  })
  if (!res.ok) {
    throw new Error(`appendRows: Sheets API append failed (${res.status}): ${await res.text().catch(() => "")}`)
  }
  const json = (await res.json()) as { updates?: { updatedRange?: string; updatedRows?: number } }
  return {
    updatedRange: json.updates?.updatedRange ?? "",
    updatedRows: json.updates?.updatedRows ?? rows.length,
  }
}

/**
 * Parses the row range Sheets echoes back (e.g. "MemoryRecords!A12:I14")
 * into the individual per-row A1 refs this job stores in
 * memory_sources.sheet_row_ref (one ref per appended memory_records row,
 * "SheetName!A<row>" -- deliberately just the row locator, not a cell
 * range or any content, since sheet_row_ref exists to let a future read
 * find its way back to the row, not to cache Sheets data in Supabase).
 */
export function expandRowRefs(updatedRange: string, count: number): string[] {
  const m = updatedRange.match(/^(.+)!([A-Z]+)(\d+):[A-Z]+(\d+)$/)
  if (!m) return []
  const [, sheetName, col, startStr, endStr] = m
  const start = Number(startStr)
  const end = Number(endStr)
  const refs: string[] = []
  for (let row = start; row <= end && refs.length < count; row++) {
    refs.push(`${sheetName}!${col}${row}`)
  }
  return refs
}
