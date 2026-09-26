// PROJEXA-BUILD-001 U-46b1 / U-47b (spec sections 3.4, 9.5, 10.1): the JWT settings of the app routes of ai-work-link, kept in one place as
// projexa-read/jwt.ts keeps its own. The link routes take NO JWT: the token in the address is the credential, so the function is
// deployed with verify_jwt false. The app routes (mint, links, warning, drafts/{id}/preview and /confirm) take a signed-in person's
// session token, which the platform's own check cannot verify for a PROJEXA sign-in (it is signed by the PROJEXA Auth project, not by
// verdian-ai), so session.ts verifies it against these values, the way projexa-read/jwt.ts does. Only /drafts/{id}/confirm is built (U-47b);
// the other app routes still answer 401 with no session and 501 with one (handler.ts). No code runs from this file: it holds constants
// only, and no secret. src/lib/services/ai-work-link-confirm.test.ts holds the values equal to projexa-read/jwt.ts.
//
// Two issuers are accepted, each with its own published ES256 key set (spec F-8): the PROJEXA Auth project, where a PROJEXA person
// signs in inside the static confirm page (spec 9.5), and the verdian-ai project, where a VERIDIAN person signs in. Both tokens are then
// mapped to one compliance user through auth_user_id by the SQL function projexa_read_resolve_user (drizzle/0618).
export const PROJEXA_ISSUER = "https://evpckeuxgvahguwsaeul.supabase.co/auth/v1"
export const PROJEXA_JWKS_URL = "https://evpckeuxgvahguwsaeul.supabase.co/auth/v1/.well-known/jwks.json"
export const VERIDIAN_ISSUER = "https://pcrjmlpuqsbocqfwoxod.supabase.co/auth/v1"
export const VERIDIAN_JWKS_URL = "https://pcrjmlpuqsbocqfwoxod.supabase.co/auth/v1/.well-known/jwks.json"
export const PROJEXA_AUDIENCE = "authenticated"
export const ACCEPTED_ALGORITHMS = ["ES256"] as const
export const JWKS_CACHE_MAX_AGE_MS = 10 * 60 * 1000
export const CLOCK_TOLERANCE_SECONDS = 5
export const VERIFY_JWT = false
