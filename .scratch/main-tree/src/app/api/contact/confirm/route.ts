import { NextRequest, NextResponse } from "next/server"
import { confirmContactEmail } from "@/lib/services/contact-service"

// Public, unauthenticated confirmation link (from the "check your email"
// message). Redirects back to /contact with a query flag rather than
// rendering its own page -- one less template to maintain.
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") ?? ""
  const ok = await confirmContactEmail(token)
  const url = new URL("/contact", request.nextUrl.origin)
  url.searchParams.set("confirmed", ok ? "1" : "0")
  return NextResponse.redirect(url)
}
