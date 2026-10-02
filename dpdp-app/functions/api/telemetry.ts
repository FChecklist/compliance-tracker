// Cloudflare Pages Function: POST/GET /api/telemetry -- the first-party,
// free monitoring endpoint for the public pages (see _telemetry.ts for what it
// stores, what it never stores, and the report). Binds the pure logic to the
// Pages Functions convention. Needs the D1 binding "DB" (wrangler.toml,
// database dpdp-telemetry) and the Pages secret REPORT_KEY for the report.
// A specific file, so it wins over any catch-all; /ai/* is a different folder.
import { handleTelemetry, type Env } from "./_telemetry"

type Context = { request: Request; env: Env }

export const onRequest = (ctx: Context) => handleTelemetry(ctx.request, ctx.env, Date.now(), String((ctx.request as { cf?: { country?: string } }).cf?.country ?? ""))
