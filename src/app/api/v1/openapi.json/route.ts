import { NextResponse } from "next/server"
import { generateOpenApiDocument } from "@/lib/openapi/generate"

// Public by design -- an API spec describing the contract shape isn't
// sensitive, and a ChatGPT custom GPT Action / integration tool needs to
// fetch this before it has a customer's key to authenticate anything else.
//
// Edge Function Utilization gap-closure (Cloud Deployment / Deployment
// Operations review): generateOpenApiDocument() is a pure function over
// the zod schemas in src/lib/schemas/*.ts -- no DB import, no Node-only
// API -- and this route is fetched by integration tooling before any
// session/API key exists, so it benefits from edge's lower cold-start
// latency with zero risk (nothing here needs a Postgres connection).
export const runtime = 'edge'

export async function GET() {
  return NextResponse.json(generateOpenApiDocument())
}
