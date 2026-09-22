// Cloudflare Pages Function: POST /ai/<token>/draft -- an AI's draft for one
// of the five verbs, proxied JSON-through to the Edge Function (which calls
// dpdp_draft_action; a draft writes one dpdp.ai_draft row and nothing
// else). See ../_proxy.ts.
import { methodNotAllowed, proxyDraft } from "../_proxy"

type Context = { request: Request; params: { token?: string | string[] } }

const param = (ctx: Context) => (Array.isArray(ctx.params.token) ? ctx.params.token.join("/") : ctx.params.token)

export const onRequestPost = (ctx: Context) => proxyDraft(ctx.request, param(ctx))
export const onRequestGet = () => methodNotAllowed("POST")
export const onRequestHead = () => methodNotAllowed("POST")
export const onRequestPut = () => methodNotAllowed("POST")
export const onRequestDelete = () => methodNotAllowed("POST")
export const onRequestPatch = () => methodNotAllowed("POST")
