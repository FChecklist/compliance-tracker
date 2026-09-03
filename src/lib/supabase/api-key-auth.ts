import { db, apiKeyRequestLog } from "@/lib/db"
import { eq, and, gte, sql } from "drizzle-orm"
import { hashSHA256 } from "@/lib/api-keys"
import { lookupApiKeyByHash } from "@/lib/db/preauth-lookups"
import { pendingApiKeyRequestCount, recordApiKeyUse } from "@/lib/auth/api-key-audit"

// R67 F-17 (R-234) x F-33 (R-278) -- THE USAGE BOOKKEEPING LEAVES THE REQUEST
// PATH. Two lanes fixed the same fault from opposite ends, and this is the
// folded result (decision D-11).
//
// Every API-key request -- which is EVERY PROJEXA request, read or write --
// wrote two rows here: api_keys.last_used_at and one api_key_request_log row.
// Neither is needed to answer the caller. Both were already un-awaited, which
// looks like "off the hot path" and is not: an un-awaited promise still
// competes for the same five-connection pool the request's own real queries are
// queued on (see the R43_EXEC_02 note in src/lib/db/index.ts -- that pool
// contending with itself is a diagnosed production fault on this codebase, not
// a hypothetical), and on Vercel a bare promise can be killed the moment the
// response is sent, so the row it was going to write is silently lost.
//
// F-33's answer was to defer both writes with next/server's after(). F-17's was
// to batch them into an in-process queue. The queue SUBSUMES the deferral and
// keeps F-33's guarantee: src/lib/auth/api-key-audit.ts schedules its flush
// through after() when a request scope exists (so the runtime keeps the
// invocation alive for the write) and degrades to setImmediate when there is
// none -- a test, a script, or its own background timer -- and every write has
// an error handler, so a failed audit row is logged rather than left as an
// unhandled rejection. On top of that it collapses N requests into ONE
// multi-row INSERT and at most one last_used_at UPDATE per key per minute,
// which is the part after() alone could not do: after() moves the two
// statements per request, it does not remove them.
//
// afterResponse(), F-33's local helper, is therefore gone rather than kept
// beside the queue -- two deferral mechanisms writing the same two rows would
// double-write them. Nothing it guaranteed is lost; see the tests at the foot
// of api-key-auth.test.ts, which now assert it of the queue.

export type ApiKeyContext = {
  orgId: string
  scopes: string[]
  keyId: string
  keyName: string
}

// Wave 96 (Comparison CSV 3 gap analysis: API002/API009): a discriminated
// result instead of `ApiKeyContext | null` so requireAuthOrApiKey() can
// return a real 429 with Retry-After, distinct from a plain 401 for an
// invalid/missing key -- the previous null-only contract couldn't express
// "this key IS valid, but it's over its limit right now."
export type ValidateApiKeyResult =
  | { status: "ok"; context: ApiKeyContext }
  | { status: "invalid" }
  | { status: "rate_limited"; retryAfterSeconds: number }

const RATE_LIMIT_WINDOW_SECONDS = 60

// Wave A (VERIDIAN Review Framework remediation, 2026-07-17, security/bug
// quick-fix item 1): keys minted with a literal, hand-chosen `id` instead
// of the standard createId() cuid every properly-provisioned key gets (see
// POST /api/settings/api-keys and /api/v1/platform/provision-org, both of
// which rely on apiKeys.id's $defaultFn) are demo/seed keys, not real
// customer-provisioned ones. "projexa_demo_key" is the one confirmed live
// in production (2026-07-17, compliance.api_keys): scopes "read,write"
// (unrestricted), rate_limit_per_minute null (unlimited) -- every opt-in
// restriction this table supports was left off -- plus, until this fix, no
// environment gate of any kind, and last_used_at showing real production
// traffic as recently as 2026-07-15.
//
// Gated the same way every platform API key already is in this codebase
// (see orchestra-model-resolver.ts's platformApiKeyFor -- GROQ_API_KEY,
// OPENROUTER_API_KEY, etc.): an env var's PRESENCE enables the capability,
// not a NODE_ENV/VERCEL_ENV branch (grepped this repo for precedent --
// the only existing NODE_ENV check anywhere, in instrumentation-client.ts,
// is a Sentry sample-rate tweak, not an access-control decision; keying off
// NODE_ENV/VERCEL_ENV directly would also misclassify or silently no-op
// across preview builds and local `bun test`/dev, which have no VERCEL_ENV
// at all). DEMO_API_KEY_IDS unset (the default in every environment,
// including current production) rejects every listed key outright with the
// same { status: "invalid" } a missing/garbage key already gets -- no new
// failure mode, no DB write required, fully reversible by setting the env
// var if a real demo/staging need is confirmed later (e.g.
// DEMO_API_KEY_IDS=projexa_demo_key in a preview/staging environment only).
// Does not delete or deactivate the key itself -- it may still be genuinely
// needed for PROJEXA's own local/preview development against a shared demo
// org -- this closes the specific gap: the key working from a live
// production deployment with no restriction at all.
const KNOWN_DEMO_KEY_IDS = new Set(["projexa_demo_key"])

function demoKeyAllowlist(): Set<string> {
  return new Set(
    (process.env.DEMO_API_KEY_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean)
  )
}

// VERIDIAN Review Framework gap-closure (2026-08-15, "API Developer
// Experience" -- Sandbox/test environment for API integrators): the
// recommended fix was to reuse the existing demo org as an interim sandbox
// rather than build a dedicated sandbox-flag system. `projexa_demo_key`
// (org `projexa_demo_org`) is that reuse candidate -- but its DB row has
// `scopes: "read,write"` (unrestricted) and `rateLimitPerMinute: null`
// (unlimited), which is fine for its original purpose (a legit internal
// PROJEXA service key) but unsafe the moment it's handed to external
// integrators as "the sandbox." Rather than mutate the DB row (which could
// break whatever legitimate internal use still depends on its exact
// scopes/limit), enforce a hard ceiling here, in code, for any key in
// KNOWN_DEMO_KEY_IDS specifically -- independent of, and always at least as
// strict as, the DB's own configured limit. Today this is a no-op in every
// real environment: the key is still rejected outright unless
// DEMO_API_KEY_IDS explicitly allowlists it (see above). The moment an
// operator does opt a demo key into sandbox use, it's automatically
// rate-limited rather than unlimited -- no separate step required. Doesn't
// touch scopes (read,write is fine for a sandbox -- integrators need to
// exercise writes too) or any non-demo key's behavior at all.
const DEMO_KEY_RATE_LIMIT_PER_MINUTE = 30

function effectiveRateLimitFor(row: { id: string; rateLimitPerMinute: number | null }): number | null {
  if (!KNOWN_DEMO_KEY_IDS.has(row.id)) return row.rateLimitPerMinute
  return row.rateLimitPerMinute === null
    ? DEMO_KEY_RATE_LIMIT_PER_MINUTE
    : Math.min(row.rateLimitPerMinute, DEMO_KEY_RATE_LIMIT_PER_MINUTE)
}

/**
 * Resolves an `Authorization: Bearer vk_...` header to the org/scopes it
 * grants. Uses the raw (RLS-bypassing) db client deliberately -- this IS
 * the authentication step itself, so it necessarily runs before any tenant
 * context exists to scope a query by (same reasoning as `autoProvisionUser`
 * in auth-guard.ts). Also enforces the key's effective rate limit (its own
 * rate_limit_per_minute -- null = unlimited -- capped at
 * DEMO_KEY_RATE_LIMIT_PER_MINUTE for known demo/sandbox keys, see
 * effectiveRateLimitFor() above), rejects a known demo/seed key unless
 * explicitly allowlisted via DEMO_API_KEY_IDS (see KNOWN_DEMO_KEY_IDS
 * above), and logs the request into api_key_request_log for both the
 * rate-limit count and the usage-analytics dashboard. Since R67 F-17 that
 * log write (and the api_keys.last_used_at touch that used to accompany it)
 * goes through the batching queue in src/lib/auth/api-key-audit.ts instead
 * of issuing two more statements on the shared pool per request; the
 * rate-limit count reads that queue's pending rows alongside the DB's.
 */
export async function validateApiKey(request: Request): Promise<ValidateApiKeyResult> {
  const authHeader = request.headers.get("authorization")
  if (!authHeader?.startsWith("Bearer ")) return { status: "invalid" }
  const token = authHeader.slice(7).trim()
  if (!token || !token.startsWith("vk_")) return { status: "invalid" }

  const keyHash = await hashSHA256(token)
  // CRR-028 expand step (R-CRR-14, see src/lib/db/preauth-lookups.ts's header
  // comment): this IS the preauth step -- runs before any tenant context
  // exists, exactly the same reasoning as this function's own doc comment
  // above -- so it now goes through the narrow SECURITY DEFINER
  // compliance.lookup_api_key_by_hash(text) function instead of an
  // unrestricted `select *`. The pre-existing app_runtime_preauth_read_api_keys
  // blanket RLS policy is untouched (other call sites still depend on it) --
  // this alone does not narrow what app_runtime can read.
  const row = await lookupApiKeyByHash(keyHash)
  if (!row || !row.isActive) return { status: "invalid" }

  if (KNOWN_DEMO_KEY_IDS.has(row.id) && !demoKeyAllowlist().has(row.id)) return { status: "invalid" }

  const route = new URL(request.url).pathname
  const rateLimit = effectiveRateLimitFor(row)
  const at = new Date()

  if (rateLimit !== null) {
    const cutoff = new Date(at.getTime() - RATE_LIMIT_WINDOW_SECONDS * 1000)
    const [{ count }] = await db.select({ count: sql<number>`count(*)` })
      .from(apiKeyRequestLog)
      .where(and(eq(apiKeyRequestLog.apiKeyId, row.id), gte(apiKeyRequestLog.createdAt, cutoff)))

    // R67 F-17: the request log is now written in batches (see
    // src/lib/auth/api-key-audit.ts), so the DB count alone is up to one flush
    // interval out of date -- which would hand every key a free window at the
    // start of each batch. The queue's own unwritten rows close it.
    const queued = pendingApiKeyRequestCount(row.id, cutoff)

    if (Number(count) + queued >= rateLimit) {
      // R67 F-33: still logged -- a rejected request is the one an operator most
      // wants to see in the usage dashboard -- but never beside the 429.
      void recordApiKeyUse({
        apiKeyId: row.id, orgId: row.orgId, route, method: request.method, wasRateLimited: true, at,
      })
      return { status: "rate_limited", retryAfterSeconds: RATE_LIMIT_WINDOW_SECONDS }
    }
  }

  // R67 F-17 x F-33: was two separate un-awaited statements on the shared max:5
  // `db` pool per request -- an INSERT here and an UPDATE of apiKeys.lastUsedAt
  // -- which src/lib/db/index.ts's own R43_EXEC_02 comment names as part of what
  // serialised that pool into 504s. Both now go through the audit queue: one
  // multi-row INSERT per batch, scheduled after the response has been sent, and
  // last_used_at at most once per key per minute. Kept here, in the helper that
  // resolves the Bearer key, so no route has to opt in.
  void recordApiKeyUse({
    apiKeyId: row.id, orgId: row.orgId, route, method: request.method, wasRateLimited: false, at,
  })

  return {
    status: "ok",
    context: {
      orgId: row.orgId,
      scopes: row.scopes.split(",").map((s) => s.trim()).filter(Boolean),
      keyId: row.id,
      keyName: row.name,
    },
  }
}
