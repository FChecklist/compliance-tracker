// PROJEXA-BUILD-001 U-25 (PMD-01): verification of a PROJEXA access token (the caller's own Supabase session JWT, issued by the
// PROJEXA Auth project evpckeuxgvahguwsaeul). No Deno global and no import here: index.ts passes `npm:jose` in, and
// src/lib/services/projexa-read-gateway.test.ts passes the same jose package from node_modules, so the rules below are the ones
// that run in production.
//
// WHAT A TOKEN MUST BE (anything else is refused, and every refusal looks the same to the caller)
//   * a compact JWS whose protected header says alg ES256 (none, HS256, RS256 and every other alg are refused before and inside
//     jose: the header pre-check and jose's own `algorithms` allow-list both hold the single value ES256);
//   * signed by a key in the PROJEXA project's published key set (PROJEXA_JWKS_URL below, fetched by jose and cached for 10
//     minutes, the same max-age the endpoint itself sends);
//   * iss exactly PROJEXA_ISSUER, aud containing "authenticated", exp in the future (5 seconds of clock tolerance), a sub that is a
//     UUID (compliance.users.auth_user_id is a uuid column), role "authenticated", and not an anonymous sign-in.
// No shared secret is involved anywhere: the key set is public and only verifies. Nothing in this file logs or returns the token.
//
// OUTCOMES: { ok: true, sub, email } | { ok: false, reason: "invalid" } (the handler answers 401) |
//   { ok: false, reason: "unavailable" } (the key set could not be fetched or read; the handler answers 503, so a PROJEXA outage
//   is not reported to the browser as "your session is bad").

export const PROJEXA_ISSUER = "https://evpckeuxgvahguwsaeul.supabase.co/auth/v1"
export const PROJEXA_JWKS_URL = "https://evpckeuxgvahguwsaeul.supabase.co/auth/v1/.well-known/jwks.json"
export const PROJEXA_AUDIENCE = "authenticated"
export const ACCEPTED_ALGORITHMS = ["ES256"] as const
export const JWKS_CACHE_MAX_AGE_MS = 10 * 60 * 1000
export const CLOCK_TOLERANCE_SECONDS = 5
const MAX_TOKEN_LENGTH = 8192
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const COMPACT_JWS_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/

/** jose's key lookup function (what createRemoteJWKSet / createLocalJWKSet return). */
export type KeyResolver = (protectedHeader: any, token: any) => Promise<any>

/** The part of jose this file uses. */
export type JoseLike = {
  jwtVerify: (jwt: string, key: KeyResolver, options: Record<string, unknown>) => Promise<{ payload: Record<string, unknown>; protectedHeader: Record<string, unknown> }>
  createRemoteJWKSet: (url: URL, options?: Record<string, unknown>) => KeyResolver
  decodeProtectedHeader: (token: string) => Record<string, unknown>
}

export type VerifiedCaller = { ok: true; sub: string; email: string | null }
export type VerifyResult = VerifiedCaller | { ok: false; reason: "invalid" | "unavailable" }

/** The production key resolver: PROJEXA's published key set, cached 10 minutes, 5 second fetch timeout. */
export function createProjexaKeyResolver(jose: Pick<JoseLike, "createRemoteJWKSet">): KeyResolver {
  return jose.createRemoteJWKSet(new URL(PROJEXA_JWKS_URL), {
    cacheMaxAge: JWKS_CACHE_MAX_AGE_MS,
    cooldownDuration: 30_000,
    timeoutDuration: 5_000,
  })
}

// jose error codes that mean "the key set could not be fetched or read", not "the token is bad".
const UNAVAILABLE_CODES = new Set(["ERR_JWKS_TIMEOUT", "ERR_JWKS_INVALID", "ERR_JOSE_GENERIC"])

function errorCode(err: unknown): string {
  return typeof err === "object" && err !== null && typeof (err as { code?: unknown }).code === "string" ? (err as { code: string }).code : ""
}

/**
 * Verify one bearer token. `keys` is the resolver (production: createProjexaKeyResolver; the test: jose's createLocalJWKSet over
 * a key pair it generated). `now` exists for the test only.
 */
export async function verifyProjexaToken(token: string, deps: { jose: JoseLike; keys: KeyResolver; now?: () => Date }): Promise<VerifyResult> {
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH || !COMPACT_JWS_RE.test(token)) {
    return { ok: false, reason: "invalid" }
  }
  let header: Record<string, unknown>
  try {
    header = deps.jose.decodeProtectedHeader(token)
  } catch {
    return { ok: false, reason: "invalid" }
  }
  if (header.alg !== "ES256") return { ok: false, reason: "invalid" }

  let payload: Record<string, unknown>
  try {
    const verified = await deps.jose.jwtVerify(token, deps.keys, {
      algorithms: [...ACCEPTED_ALGORITHMS],
      issuer: PROJEXA_ISSUER,
      audience: PROJEXA_AUDIENCE,
      requiredClaims: ["exp", "sub"],
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
      ...(deps.now ? { currentDate: deps.now() } : {}),
    })
    payload = verified.payload
  } catch (err) {
    const code = errorCode(err)
    if (UNAVAILABLE_CODES.has(code)) return { ok: false, reason: "unavailable" }
    // A fetch that never produced a response (DNS, TLS, connection reset) surfaces as a plain TypeError from fetch.
    if (err instanceof TypeError && !code) return { ok: false, reason: "unavailable" }
    return { ok: false, reason: "invalid" }
  }

  const sub = payload.sub
  if (typeof sub !== "string" || !UUID_RE.test(sub)) return { ok: false, reason: "invalid" }
  if (payload.role !== "authenticated") return { ok: false, reason: "invalid" }
  if (payload.is_anonymous === true) return { ok: false, reason: "invalid" }
  const email = typeof payload.email === "string" && payload.email.trim() !== "" ? payload.email.trim() : null
  return { ok: true, sub: sub.toLowerCase(), email }
}
