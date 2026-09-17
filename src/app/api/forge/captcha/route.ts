import { NextResponse } from "next/server"
import { generateCaptcha } from "@/lib/forge-captcha"

// Public, unauthenticated -- issues a fresh math-captcha challenge for the
// FORGE intake form. No state stored server-side; the token itself carries
// what's needed to verify the answer at submit time.
//
// Edge Function Utilization gap-closure (Cloud Deployment / Deployment
// Operations review) originally set this to `runtime = 'edge'`:
// generateCaptcha() itself is pure and DB-free (see forge-captcha.ts's
// header), so the intent was sound. Reverted 2026-09-17: Vercel's build
// failed with NOW_SANDBOX_WORKER_EDGE_FUNCTION_UNSUPPORTED_MODULES,
// reporting this function's bundle as pulling in node:child_process,
// node:crypto and node:fs -- not from this file or forge-captcha.ts (both
// clean, verified by inspection), but almost certainly from the Sentry
// build wrapper's edge instrumentation (next.config.ts's withSentryConfig)
// picking up Node built-ins somewhere in this route's dependency graph.
// Root-causing the Sentry/edge interaction is out of scope for
// un-blocking a production deploy; this route is a low-traffic public
// lead-capture-form challenge, so the latency difference between edge and
// the default Node.js runtime is not worth the build failure. Revisit if
// edge is needed again later -- fix the actual unsupported-module source
// first, don't just re-add this line.

export async function GET() {
  return NextResponse.json(generateCaptcha())
}
