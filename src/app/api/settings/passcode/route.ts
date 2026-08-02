import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { setPasscode, removePasscode, isValidPasscodeFormat } from "@/lib/passcode-login-service"

// Priority 14 Wave 2 (GAP-AUTH-REBUILD): Settings > Security surface for the
// additive 4-digit passcode -- set/change/remove only, ALL requireAuth()-
// gated. There is no "forgot your passcode" flow here or anywhere else:
// magic-link/Google-OAuth/password/SSO remain the only way to prove
// identity, both for normal login and for resetting a forgotten passcode
// (by logging in the normal way, then coming back here). See
// src/lib/passcode-login-service.ts's header comment for the full
// security-property writeup.

export async function GET() {
  const { response, dbUser } = await requireAuth()
  if (response) return response
  if (!dbUser) return NextResponse.json({ error: "No account found" }, { status: 400 })

  return NextResponse.json({
    hasPasscode: !!dbUser.passcodeHash,
    setAt: dbUser.passcodeSetAt?.toISOString() ?? null,
  })
}

export async function POST(request: NextRequest) {
  const { response, dbUser } = await requireAuth()
  if (response) return response
  if (!dbUser) return NextResponse.json({ error: "No account found" }, { status: 400 })

  try {
    const body = await request.json()
    const passcode = typeof body.passcode === "string" ? body.passcode.trim() : ""
    const confirmPasscode = typeof body.confirmPasscode === "string" ? body.confirmPasscode.trim() : ""

    if (!isValidPasscodeFormat(passcode)) {
      return NextResponse.json({ error: "Passcode must be exactly 4 digits" }, { status: 400 })
    }
    if (passcode !== confirmPasscode) {
      return NextResponse.json({ error: "Passcodes do not match" }, { status: 400 })
    }

    const result = await setPasscode(dbUser.id, passcode)
    if (!result.ok) {
      return NextResponse.json({ error: result.reason }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Set passcode error:", error)
    return NextResponse.json({ error: "Failed to set passcode" }, { status: 500 })
  }
}

export async function DELETE() {
  const { response, dbUser } = await requireAuth()
  if (response) return response
  if (!dbUser) return NextResponse.json({ error: "No account found" }, { status: 400 })

  try {
    await removePasscode(dbUser.id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Remove passcode error:", error)
    return NextResponse.json({ error: "Failed to remove passcode" }, { status: 500 })
  }
}
