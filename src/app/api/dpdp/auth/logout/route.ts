import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { revokeDpdpSession } from "@/lib/services/dpdp-auth-service"
import { DPDP_SESSION_COOKIE, clearDpdpSessionCookie } from "@/lib/services/dpdp-session"
import { dpdpErrorResponse } from "@/lib/services/dpdp-route-helpers"

export async function POST() {
  try {
    const store = await cookies()
    const raw = store.get(DPDP_SESSION_COOKIE)?.value
    if (raw) await revokeDpdpSession(raw)
    await clearDpdpSessionCookie()
    return NextResponse.json({ ok: true })
  } catch (error) {
    return dpdpErrorResponse(error, "Could not sign you out")
  }
}
