// Small shared helper so every src/app/api/dpdp/** route's catch block is
// one line, matching this repo's own established try/catch-per-route
// convention (see e.g. src/app/api/v1/construction/boq/categories/route.ts)
// rather than introducing a route-wrapper abstraction this codebase
// doesn't otherwise use.
import { NextResponse } from "next/server"
import { ServiceError } from "@/lib/services/compliance-service"

export function dpdpErrorResponse(error: unknown, fallbackMessage: string): NextResponse {
  if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
  console.error(`[dpdp] ${fallbackMessage}:`, error)
  return NextResponse.json({ error: fallbackMessage }, { status: 500 })
}
