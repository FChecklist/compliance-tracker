import { NextResponse } from "next/server"
import { recordAuthFailureAndCheckAnomaly, isValidAuthFailureMethod } from "@/lib/services/auth-failure-service"

// VERIDIAN Review Framework gap-closure: Anomaly Detection, "repeated
// failed auth". Public, pre-auth route -- the client calls this right
// after a login attempt fails (see login-form.tsx's handleLogin), the same
// posture as passcode-login/route.ts (no session exists yet at the point a
// login fails, so this can never be requireAuth()-gated). Once a request
// carries a usable (email, method) pair, this ALWAYS returns { ok: true }
// regardless of what happened internally -- never reveals whether the
// email matched a real account, same generic-response posture as
// verifyPasscodeLogin. That property is unaffected by the check below.
//
// DOD-C8 fix (2026-09-10): a request this route cannot even attribute to an
// email/method -- unparseable JSON, no email, or an unrecognized method --
// previously ALSO returned { ok: true } and never called
// recordAuthFailureAndCheckAnomaly at all. A credential-stuffing script
// hitting this endpoint directly (bypassing the real client) could send
// exactly such a body on every call and suppress the repeated-failed-auth
// signal entirely, with no observable difference in the response. Now
// returns 400 in that case instead -- a signal about REQUEST SHAPE only,
// derivable from the request alone, independent of whether the email
// matches a real account, so it adds no account-enumeration information;
// the anti-enumeration property above is about well-formed requests, which
// this leaves untouched.
export async function POST(request: Request) {
  let body: { email?: unknown; method?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: "malformed request body" }, { status: 400 })
  }

  const email = typeof body.email === "string" ? body.email.trim() : ""
  const method = typeof body.method === "string" ? body.method : ""
  if (!email || !isValidAuthFailureMethod(method)) {
    return NextResponse.json({ ok: false, error: "email and a recognized method are required" }, { status: 400 })
  }

  const ipAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? request.headers.get("x-real-ip")
    ?? undefined

  try {
    await recordAuthFailureAndCheckAnomaly({ email, method, ipAddress })
  } catch (error) {
    console.error("Failed to record auth-failure event:", error)
  }

  return NextResponse.json({ ok: true })
}
