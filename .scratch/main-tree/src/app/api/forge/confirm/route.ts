import { NextRequest, NextResponse } from "next/server"
import { confirmForgeEmail } from "@/lib/services/forge-intake-service"

// Public, unauthenticated confirmation link. Redirects back to /forge with a
// query flag rather than rendering its own page.
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") ?? ""
  const ok = await confirmForgeEmail(token)
  const url = new URL("/forge", request.nextUrl.origin)
  url.searchParams.set("confirmed", ok ? "1" : "0")
  return NextResponse.redirect(url)
}
