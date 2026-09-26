// PROJEXA-BUILD-001 U-46b1 (spec sections 3.4, 9.5, 10.1): the JWT settings of the app routes of ai-work-link, kept in one place as
// projexa-read/jwt.ts keeps its own. The link routes take NO JWT: the token in the address is the credential, so the function is
// deployed with verify_jwt false. The app routes (mint, links, warning, drafts/{id}/preview and /confirm) take a signed-in person's
// session token, which the platform's own check cannot verify (it is signed by the PROJEXA Auth project, not by verdian-ai), so a later
// unit verifies it here against these values, the way projexa-read/jwt.ts does. Until that unit exists the app routes answer 401 with no
// session and 501 with one (handler.ts). No code runs from this file: it holds constants only, and no secret.
export const PROJEXA_ISSUER = "https://evpckeuxgvahguwsaeul.supabase.co/auth/v1"
export const PROJEXA_JWKS_URL = "https://evpckeuxgvahguwsaeul.supabase.co/auth/v1/.well-known/jwks.json"
export const PROJEXA_AUDIENCE = "authenticated"
export const ACCEPTED_ALGORITHMS = ["ES256"] as const
export const VERIFY_JWT = false
