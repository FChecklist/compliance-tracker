// Cloudflare Pages Function: EVERY method and sub-path under /ai/ --
// GET /ai/<token> (the manual), /ai/<token>/manual.md, /context, /jobs,
// /jobs/<id>, /law/<code>, /report/<kind>, /history, /snapshot.md,
// POST /ai/<token>/actions and /drafts (and the pre-WO-013 addresses
// /ai/<token>.md and POST /ai/<token>/draft). All logic lives in _proxy.ts,
// which is unit-tested (src/lib/ai-proxy.test.ts); this file only binds it
// to the Pages Functions convention. No dependencies, no bindings, no
// secrets: the token in the path is the credential and the database decides
// what it may see and do.
import { proxyRequest } from "./_proxy"

type Context = { request: Request; params: { path?: string | string[] } }

export const onRequest = (ctx: Context) => proxyRequest(ctx.request, ctx.params.path)
