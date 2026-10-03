import postgres from "postgres"
import { getConnectionString } from "@/lib/db/connection-string"

// 2026-10-03 -- WHY API-KEY AUDIT WRITES HAVE THEIR OWN CONNECTION, AND WHY A TIMEOUT NOW CANCELS THE QUERY.
//
// Live evidence (Vercel get_runtime_errors, 2026-10-01..10-02): ECHECKOUTTIMEOUT "unable to check out connection from the pool after
// 15000ms in Transaction mode" on compliance.lookup_api_key_by_hash, and "audit write timed out after 5000 ms" on the audit writes.
// The 5 s time box in api-key-audit.ts (#2013) is a Promise.race: it rejects the JS promise but never touches the query, so the
// statement kept its connection on the shared `db` pool (max 5) until the server ended it. Audit rows are the lowest-value traffic
// on that pool and were the ones able to starve the key lookup every real request needs.
//
// What this does instead: audit writes run on a dedicated one-connection client (they can no longer take a connection the key
// lookup needs), the server aborts a statement after STATEMENT_TIMEOUT_MS, and when the client-side time box fires the query is
// cancelled AND the connection is torn down, so nothing is left checked out. A fresh client is created on the next write.
//
// Honest limit: a client-side teardown cannot prove what Supavisor does with a backend it has already handed out; the 2026-10-03
// kill/freeze-client reproduction did not produce stuck backends either way (see memory stuck-connections-rca-attempt-2026-10-03).
// This removes the one mechanism that is provably in the code, not a cause proven live.

export const AUDIT_STATEMENT_TIMEOUT_MS = 4_000

type PendingQuery = PromiseLike<unknown> & { cancel?: () => void }
type AuditClient = {
  (strings: TemplateStringsArray, ...values: unknown[]): PendingQuery
  end: (opts?: { timeout?: number }) => Promise<void>
}

let client: AuditClient | null = null

function getClient(): AuditClient {
  if (!client) {
    client = postgres(getConnectionString(), {
      prepare: false,
      ssl: { rejectUnauthorized: false },
      max: 1,
      connect_timeout: 5,
      idle_timeout: 10,
      connection: { statement_timeout: AUDIT_STATEMENT_TIMEOUT_MS },
    }) as unknown as AuditClient
  }
  return client
}

function discardClient(dead: AuditClient): void {
  if (client === dead) client = null
  // timeout: 0 closes sockets immediately instead of waiting for in-flight queries.
  void dead.end({ timeout: 0 }).catch(() => {})
}

/**
 * Runs one audit statement. On `timeoutMs` the query is cancelled, the connection is torn down, and the returned promise rejects.
 * Exported with injectable client access so the cancel-and-teardown behaviour is testable without a database.
 */
export async function runAuditStatement(
  build: (sql: AuditClient) => PendingQuery,
  timeoutMs: number,
  access: { get: () => AuditClient; discard: (c: AuditClient) => void } = { get: getClient, discard: discardClient },
): Promise<void> {
  const sql = access.get()
  const query = build(sql)
  let handle: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    handle = setTimeout(() => {
      try {
        query.cancel?.()
      } catch {
        // cancel is best effort; the teardown below is what releases the connection
      }
      access.discard(sql)
      reject(new Error(`audit write timed out after ${timeoutMs} ms (cancelled, connection discarded)`))
    }, timeoutMs)
  })
  try {
    await Promise.race([query, timeout])
  } finally {
    clearTimeout(handle)
  }
}

export function insertAuditRows(payloadJson: string, timeoutMs: number): Promise<void> {
  return runAuditStatement((sql) => sql`select compliance.record_api_key_request_batch(${payloadJson}::jsonb)`, timeoutMs)
}

export function touchApiKeyLastUsed(apiKeyId: string, at: Date, timeoutMs: number): Promise<void> {
  return runAuditStatement(
    (sql) => sql`update compliance.api_keys set last_used_at = ${at.toISOString()}::timestamp where id = ${apiKeyId}`,
    timeoutMs,
  )
}
