import { NextResponse } from "next/server"
import { recordAuthFailureAndCheckAnomaly, isValidAuthFailureMethod } from "@/lib/services/auth-failure-service"

// VERIDIAN Review Framework gap-closure: Anomaly Detection, "repeated
// failed auth". Public, pre-auth route -- the client calls this right
// after a login attempt fails (see login-form.tsx's handleLogin), the same
// posture as passcode-login/route.ts (no session exists yet at the point a
// login fails, so this can never be requireAuth()-gated). Deliberately
// always returns { ok: true } regardless of what happened internally --
// never reveals whether the email matched a real account, same generic-
// response posture as verifyPasscodeLogin.
export async function POST(request: Request) {
  let body: { email?: unknown; method?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: true })
  }

  const email = typeof body.email === "string" ? body.email.trim() : ""
  const method = typeof body.method === "string" ? body.method : ""
  if (!email || !isValidAuthFailureMethod(method)) {
    return NextResponse.json({ ok: true })
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
