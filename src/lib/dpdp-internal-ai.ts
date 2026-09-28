// Owner directive 2026-09-28: the DPDP product's work flow is email plus the
// EXTERNAL AI work link (app.veridian-aios.com/ai/<token>, served by the
// dpdp-ai-link Edge Function, made from the static app's "Copy AI link"
// screen). The two older in-app AI surfaces of this Next.js app --
// /dpdp/ai-link (its own token, read through /api/dpdp/ai/[token]) and
// /dpdp/ai-work (a pasted-back "AI proposals" review queue) -- are the
// INTERNAL AI work link option. They are switched off here rather than
// deleted: the pages, routes and services stay in the tree, and setting
// DPDP_INTERNAL_AI_ENABLED=1 brings them back exactly as they were. Nothing
// in the external link, the email flow or the dpdp schema depends on them
// (live data at the time of the change: dpdp.ai_link_read 0 rows,
// dpdp.ai_proposal 0 rows).
import { NextResponse } from "next/server"

export function dpdpInternalAiEnabled(): boolean {
  return process.env.DPDP_INTERNAL_AI_ENABLED === "1"
}

/** The same body a route that does not exist would give, so the switch reveals nothing. */
export function dpdpInternalAiOffResponse(): NextResponse {
  return NextResponse.json({ error: "Not found" }, { status: 404 })
}
