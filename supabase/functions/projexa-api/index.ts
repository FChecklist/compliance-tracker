// PROJEXA API edge proxy (AUDIT-100 A2). Wires Deno.serve, the session verifier of ai-work-link (PROJEXA Auth project's published ES256 keys)
// and the two PROJEXA lookups to handler.ts. Deploy with verify_jwt false: a PROJEXA session token is signed by the PROJEXA Auth project, not by
// verdian-ai, so the platform's own check would refuse it; session.ts verifies it instead. See handler.ts and README.md.
//
// Secrets (Supabase function secrets, never in a browser or in git):
//   PROJEXA_SUPABASE_URL           https://evpckeuxgvahguwsaeul.supabase.co (public)
//   PROJEXA_SUPABASE_ANON_KEY      the PROJEXA project's public anon key (memberships are read with the person's own token under RLS)
//   PROJEXA_SERVICE_ROLE_KEY       reads (and, while PX_MIRROR_LEGACY_CREDENTIALS is not "false", mirror-writes) the legacy PROJEXA public.veridian_credentials and nothing else
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (platform-injected, verdian-ai)  the compliance-side credentials + provisioning functions (drizzle/0729)
//   VERIDIAN_API_BASE_URL          what PROJEXA's veridian-client.ts uses (".../api/v1/projexa")
import { createClient } from "npm:@supabase/supabase-js@2"
import * as jose from "npm:jose@6.2.10"
import { createKeyResolvers, createSessionVerifier, type JoseLike } from "../ai-work-link/session.ts"
import { PROJEXA_ISSUER } from "../ai-work-link/jwt.ts"
import { handleApi } from "./handler.ts"
import { createCompanyMembershipLookup, createMembershipLookup, createOrgKeyLookup } from "./lookups.ts"
import { handleOrg, isOrgRequest } from "./org-provision.ts"
import { handleUploadSign, isUploadSignRequest, publicObjectUrl, UPLOAD_BUCKET } from "./upload-sign.ts"
import { createEnsureMemberRpc, createVeridianOrgIdLookup, handleMemberLink, isMemberLinkRequest } from "./member-link.ts"

const redact = (v: unknown): string => String((v as { message?: unknown })?.message ?? v).replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "<token>").slice(0, 300)
globalThis.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
  console.error("projexa-api: unhandled rejection:", redact(e.reason))
  e.preventDefault()
})

const projexaUrl = Deno.env.get("PROJEXA_SUPABASE_URL") ?? ""
const joseLike = jose as unknown as JoseLike
const session = createSessionVerifier({ jose: joseLike, keys: createKeyResolvers(joseLike) })
const membership = createMembershipLookup({ projexaUrl, anonKey: Deno.env.get("PROJEXA_SUPABASE_ANON_KEY") ?? "" })
const companyMembership = createCompanyMembershipLookup({ projexaUrl, anonKey: Deno.env.get("PROJEXA_SUPABASE_ANON_KEY") ?? "" })
const upstreamBase = Deno.env.get("VERIDIAN_API_BASE_URL") ?? "https://veridian-compliance-ai.vercel.app/api/v1/projexa"

// audit100/link-invited-members (member-link.ts): POST /link-member gives the signed-in person their own VERIDIAN user (drizzle/0728). The verdian-ai
// service-role client is the platform-injected one (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY, the same pair ai-work-link uses); it runs only that one function.
const veridianDb = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
const rpc = async (fn: string, args: Record<string, unknown>) => {
  const { data, error } = await veridianDb.rpc(fn, args)
  return { data, error }
}
// G-09: the per-organisation VERIDIAN key comes from the compliance-side table (public.projexa_org_credential_get), the legacy PROJEXA table only for an
// organisation not moved yet. PX_MIRROR_LEGACY_CREDENTIALS=false stops new organisations being mirrored to the legacy table (the move is then complete).
const projexaServiceKey = Deno.env.get("PROJEXA_SERVICE_ROLE_KEY") ?? ""
const orgKey = createOrgKeyLookup({ projexaUrl, serviceRoleKey: projexaServiceKey, rpc })
const orgDeps = {
  session,
  issuer: PROJEXA_ISSUER,
  membership,
  rpc,
  projexaUrl,
  projexaAnonKey: Deno.env.get("PROJEXA_SUPABASE_ANON_KEY") ?? "",
  legacy: projexaServiceKey ? { serviceRoleKey: projexaServiceKey, mirror: Deno.env.get("PX_MIRROR_LEGACY_CREDENTIALS") !== "false" } : undefined,
}
const memberLinkDeps = {
  session,
  issuer: PROJEXA_ISSUER,
  membership,
  veridianOrgId: createVeridianOrgIdLookup({ projexaUrl, serviceRoleKey: projexaServiceKey, rpc }),
  ensure: createEnsureMemberRpc(async (fn, args) => {
    const { data, error } = await veridianDb.rpc(fn, args)
    return { data, error }
  }),
}

const uploadDeps = {
  session,
  issuer: PROJEXA_ISSUER,
  membership,
  reserve: async (orgId: string, limit: number) => {
    const { data, error } = await veridianDb.rpc("projexa_upload_sign_reserve", { p_org: orgId, p_limit: limit })
    return error || typeof data !== "boolean" ? ({ ok: false } as const) : ({ ok: true, allowed: data } as const)
  },
  sign: async (objectPath: string) => {
    const { data, error } = await veridianDb.storage.from(UPLOAD_BUCKET).createSignedUploadUrl(objectPath)
    return error || !data?.signedUrl ? ({ ok: false } as const) : ({ ok: true, signedUrl: data.signedUrl } as const)
  },
  publicUrl: (objectPath: string) => publicObjectUrl(Deno.env.get("SUPABASE_URL") ?? "", objectPath),
}

Deno.serve((req: Request) => (isOrgRequest(req) ? handleOrg(req, orgDeps) : isUploadSignRequest(req) ? handleUploadSign(req, uploadDeps) : isMemberLinkRequest(req) ? handleMemberLink(req, memberLinkDeps) : handleApi(req, { session, issuer: PROJEXA_ISSUER, membership, companyMembership, orgKey, upstreamBase })))
