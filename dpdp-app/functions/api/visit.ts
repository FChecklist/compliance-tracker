// Cloudflare Pages Function: POST /api/visit -- the first-party visit-journey beacon relay (see _visit.ts for what it adds and what it never does).
// Pages secret VISIT_PROXY_KEY (optional but needed for city / trusted address): `wrangler pages secret put VISIT_PROXY_KEY`, same value as the Edge Function secret DPDP_VISIT_PROXY_KEY.
import { relayVisit, type Env } from "./_visit"

type Context = { request: Request; env: Env }

export const onRequest = (ctx: Context) => relayVisit(ctx.request, ctx.env, (ctx.request as { cf?: { city?: string; country?: string; asn?: number } }).cf)
