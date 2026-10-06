// Cloudflare Pages Function: GET /api/mode -- see _mode.ts.
import { readMode, type Env } from "./_mode"

export const onRequest = (ctx: { request: Request; env: Env }) => readMode(ctx.request.method, ctx.env)
