// Cloudflare Pages Function: GET /ai/<token> and GET /ai/<token>.md (the
// `[token]` segment carries the ".md" suffix when present). All logic lives
// in _proxy.ts, which is unit-tested; this file only binds it to the Pages
// Functions convention. No dependencies, no bindings, no secrets: the token
// in the path is the credential and the database decides what it may see.
import { methodNotAllowed, proxyGet } from "./_proxy"

type Context = { request: Request; params: { token?: string | string[] } }

const param = (ctx: Context) => (Array.isArray(ctx.params.token) ? ctx.params.token.join("/") : ctx.params.token)

export const onRequestGet = (ctx: Context) => proxyGet(ctx.request, param(ctx))
export const onRequestHead = (ctx: Context) => proxyGet(ctx.request, param(ctx))
export const onRequestPost = () => methodNotAllowed("GET, HEAD")
export const onRequestPut = () => methodNotAllowed("GET, HEAD")
export const onRequestDelete = () => methodNotAllowed("GET, HEAD")
export const onRequestPatch = () => methodNotAllowed("GET, HEAD")
