import { NextResponse } from "next/server"
import { generateOpenApiDocument } from "@/lib/openapi/generate"

// Public by design -- an API spec describing the contract shape isn't
// sensitive, and a ChatGPT custom GPT Action / integration tool needs to
// fetch this before it has a customer's key to authenticate anything else.
//
// Edge Function Utilization gap-closure (Cloud Deployment / Deployment
// Operations review) originally set this to `runtime = 'edge'`:
// generateOpenApiDocument() is a pure function over the zod schemas in
// src/lib/schemas/*.ts, no DB import, no Node-only API. Reverted
// 2026-09-17, same reason as api/forge/captcha/route.ts: Vercel's build
// failed with NOW_SANDBOX_WORKER_EDGE_FUNCTION_UNSUPPORTED_MODULES
// (node:child_process/node:crypto/node:fs pulled into the edge bundle,
// most likely by the Sentry build wrapper's edge instrumentation --
// see that file's comment for the full reasoning). This route is fetched
// rarely (integration tooling discovering the API contract), so the
// cold-start latency difference is not worth another failed deploy.

export async function GET() {
  return NextResponse.json(generateOpenApiDocument())
}
