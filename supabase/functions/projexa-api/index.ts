// PROJEXA API edge proxy (AUDIT-100 A2). Wires Deno.serve, the session verifier of ai-work-link (PROJEXA Auth project's published ES256 keys)
// and the two PROJEXA lookups to handler.ts. Deploy with verify_jwt false: a PROJEXA session token is signed by the PROJEXA Auth project, not by
// verdian-ai, so the platform's own check would refuse it; session.ts verifies it instead. See handler.ts and README.md.
//
// Secrets (Supabase function secrets, never in a browser or in git):
//   PROJEXA_SUPABASE_URL           https://evpckeuxgvahguwsaeul.supabase.co (public)
//   PROJEXA_SUPABASE_ANON_KEY      the PROJEXA project's public anon key (memberships are read with the person's own token under RLS)
//   PROJEXA_SERVICE_ROLE_KEY       reads public.veridian_credentials (the per-organisation VERIDIAN key) and nothing else
//   VERIDIAN_API_BASE_URL          what PROJEXA's veridian-client.ts uses (".../api/v1/projexa")
import * as jose from "npm:jose@6.2.10"
import { createKeyResolvers, createSessionVerifier, type JoseLike } from "../ai-work-link/session.ts"
import { PROJEXA_ISSUER } from "../ai-work-link/jwt.ts"
import { handleApi } from "./handler.ts"
import { createMembershipLookup, createOrgKeyLookup } from "./lookups.ts"

const redact = (v: unknown): string => String((v as { message?: unknown })?.message ?? v).replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "<token>").slice(0, 300)
globalThis.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
  console.error("projexa-api: unhandled rejection:", redact(e.reason))
  e.preventDefault()
})

const projexaUrl = Deno.env.get("PROJEXA_SUPABASE_URL") ?? ""
const joseLike = jose as unknown as JoseLike
const session = createSessionVerifier({ jose: joseLike, keys: createKeyResolvers(joseLike) })
const membership = createMembershipLookup({ projexaUrl, anonKey: Deno.env.get("PROJEXA_SUPABASE_ANON_KEY") ?? "" })
const orgKey = createOrgKeyLookup({ projexaUrl, serviceRoleKey: Deno.env.get("PROJEXA_SERVICE_ROLE_KEY") ?? "" })
const upstreamBase = Deno.env.get("VERIDIAN_API_BASE_URL") ?? "https://veridian-compliance-ai.vercel.app/api/v1/projexa"

Deno.serve((req: Request) => handleApi(req, { session, issuer: PROJEXA_ISSUER, membership, orgKey, upstreamBase }))
