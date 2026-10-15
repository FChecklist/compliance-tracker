// Test / Live mode gate for EVERY outbound e-mail of the DPDP Edge Functions (drizzle/0735).
//
// Call mailGate(to, "<function name>") right before the provider call. In TEST mode only addresses on the owner-managed allowlist
// (dpdp.mail_allowlist, default: the platform owner) get the mail; every other recipient is suppressed and logged in the database as
// suppressed_test_mode (a hash of the address and its domain, never the address). In LIVE mode nothing changes for real people, except that
// the contacts of a test account are never mailed either (suppressed_test_account).
//
// The decision itself is made in the database (public.dpdp_mail_gate, service role only). decideMail below is the same rule as a pure
// function: src/lib/services/dpdp-test-live-mode.pglite.test.ts compares it with dpdp.mail_decision over every input.
//
// If the gate cannot be reached it THROWS: the caller then treats the send as failed and retries later, which is right in both modes
// (a mail must not leave in TEST mode just because the database was slow, and a LIVE mail is only delayed, not lost).
//
// PURE like mail-outbound.ts: no supabase-js import, fetch and environment are injectable so bun tests can run it.

export type MailDecision = "live" | "allowlisted" | "suppressed_test_mode" | "suppressed_test_account"

/** The id a send site returns for a suppressed mail so its queue marks the row done instead of retrying for ever. Never a real provider id. */
export const SUPPRESSED_MESSAGE_ID = "suppressed_test_mode"

export const GATE_RPC = "dpdp_mail_gate"

export function decideMail(testMode: boolean, allowlisted: boolean, testRecipient: boolean): MailDecision {
  if (testMode) return allowlisted ? "allowlisted" : "suppressed_test_mode"
  if (testRecipient && !allowlisted) return "suppressed_test_account"
  return "live"
}

export type GateResult = { send: boolean; reason: MailDecision; mode: "TEST" | "LIVE" }

export type GateDeps = {
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>
  url?: string
  key?: string
}

type DenoLike = { env: { get: (k: string) => string | undefined } }

function envOf(k: string): string {
  const d = (globalThis as unknown as { Deno?: DenoLike }).Deno
  return d?.env.get(k) ?? ""
}

export async function mailGate(to: string, source: string, deps: GateDeps = {}): Promise<GateResult> {
  const url = (deps.url ?? envOf("SUPABASE_URL")).replace(/\/+$/, "")
  const key = deps.key ?? envOf("SUPABASE_SERVICE_ROLE_KEY")
  if (!url || !key) throw new Error("mail gate is not configured")
  const f = deps.fetchImpl ?? fetch
  const res = await f(`${url}/rest/v1/rpc/${GATE_RPC}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_to: to, p_source: source }),
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) throw new Error(`mail gate answered ${res.status}`)
  const body = (await res.json().catch(() => null)) as Partial<GateResult> | null
  if (!body || typeof body.send !== "boolean") throw new Error("mail gate gave no answer")
  return body as GateResult
}
