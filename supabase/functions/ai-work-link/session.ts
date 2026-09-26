// PROJEXA-BUILD-001 U-47b (spec sections 9.5 and 3.4; register row BR-497): the verification of a signed-in person's access token for the app
// routes of ai-work-link. No Deno global and no import here: index.ts passes `npm:jose` in, and src/lib/services/ai-work-link-confirm.test.ts
// passes the same jose package from node_modules, so the rules below are the ones that run in production. All cryptography is jose's: this
// file only chooses which published key set to check against and applies the same claim rules as supabase/functions/projexa-read/jwt.ts.
//
// WHAT A TOKEN MUST BE (anything else is refused, and every refusal looks the same to the caller)
//   * a compact JWS whose protected header says alg ES256 (none, HS256, RS256 and every other alg are refused before and inside jose);
//   * issued by one of the two Auth projects in jwt.ts (PROJEXA or verdian-ai). The `iss` claim is read WITHOUT trust only to pick the key
//     set; jose then requires that exact issuer and a signature from THAT project's published key set, so a token cannot borrow the other
//     project's key set;
//   * aud containing "authenticated", exp in the future (5 seconds of tolerance), a sub that is a UUID, role "authenticated", and not an
//     anonymous sign-in.
// OUTCOMES: { ok: true, sub, email, issuer, iat } | { ok: false, reason: "invalid" } (the handler answers 401) | { ok: false, reason: "unavailable" }
// (a key set could not be fetched or read; the handler answers 503, so an Auth outage is not reported as "your session is bad").
// Nothing in this file logs or returns the token.
//
// NOT DONE HERE: the live-session check of spec 9.5 (GET /auth/v1/user with email_confirmed_at). It would be an outbound fetch from this
// function, which the U-46b1 static rules forbid, and it needs each project's public API key as a setting. A signed-out session therefore
// stays usable until its token expires. See the U-47b report.
import {
  ACCEPTED_ALGORITHMS, CLOCK_TOLERANCE_SECONDS, JWKS_CACHE_MAX_AGE_MS, PROJEXA_AUDIENCE, PROJEXA_ISSUER, PROJEXA_JWKS_URL, VERIDIAN_ISSUER, VERIDIAN_JWKS_URL,
} from "./jwt.ts"

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
  decodeJwt: (token: string) => Record<string, unknown>
}

/** `iat` is the token's issued-at time in seconds, or null when the token has none (the mint route treats null as stale). */
export type SessionVerdict = { ok: true; sub: string; email: string | null; issuer: string; iat: number | null } | { ok: false; reason: "invalid" | "unavailable" }
export type SessionVerifier = (token: string) => Promise<SessionVerdict>
export type KeysByIssuer = Readonly<Record<string, KeyResolver>>

/** The production key resolvers: each project's published key set, cached 10 minutes, 5 second fetch timeout. */
export function createKeyResolvers(jose: Pick<JoseLike, "createRemoteJWKSet">): KeysByIssuer {
  const make = (url: string) => jose.createRemoteJWKSet(new URL(url), { cacheMaxAge: JWKS_CACHE_MAX_AGE_MS, cooldownDuration: 30_000, timeoutDuration: 5_000 })
  return { [PROJEXA_ISSUER]: make(PROJEXA_JWKS_URL), [VERIDIAN_ISSUER]: make(VERIDIAN_JWKS_URL) }
}

// jose error codes that mean "the key set could not be fetched or read", not "the token is bad".
const UNAVAILABLE_CODES = new Set(["ERR_JWKS_TIMEOUT", "ERR_JWKS_INVALID", "ERR_JOSE_GENERIC"])

function errorCode(err: unknown): string {
  return typeof err === "object" && err !== null && typeof (err as { code?: unknown }).code === "string" ? (err as { code: string }).code : ""
}

/** `now` exists for the test only. */
export function createSessionVerifier(deps: { jose: JoseLike; keys: KeysByIssuer; now?: () => Date }): SessionVerifier {
  return async (token: string): Promise<SessionVerdict> => {
    if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH || !COMPACT_JWS_RE.test(token)) return { ok: false, reason: "invalid" }
    let issuer: unknown
    try {
      if (deps.jose.decodeProtectedHeader(token).alg !== "ES256") return { ok: false, reason: "invalid" }
      issuer = deps.jose.decodeJwt(token).iss
    } catch {
      return { ok: false, reason: "invalid" }
    }
    if (typeof issuer !== "string" || !Object.prototype.hasOwnProperty.call(deps.keys, issuer)) return { ok: false, reason: "invalid" }

    let payload: Record<string, unknown>
    try {
      const verified = await deps.jose.jwtVerify(token, deps.keys[issuer], {
        algorithms: [...ACCEPTED_ALGORITHMS],
        issuer,
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
    const iat = typeof payload.iat === "number" && Number.isFinite(payload.iat) ? payload.iat : null
    return { ok: true, sub: sub.toLowerCase(), email, issuer, iat }
  }
}
