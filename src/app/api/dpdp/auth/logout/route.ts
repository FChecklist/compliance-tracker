import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { revokeDpdpSession } from "@/lib/services/dpdp-auth-service"
import { DPDP_SESSION_COOKIE, clearDpdpSessionCookie } from "@/lib/services/dpdp-session"

export async function POST() {
  const store = await cookies()
  const raw = store.get(DPDP_SESSION_COOKIE)?.value
  if (raw) await revokeDpdpSession(raw)
  await clearDpdpSessionCookie()
  return NextResponse.json({ ok: true })
}
