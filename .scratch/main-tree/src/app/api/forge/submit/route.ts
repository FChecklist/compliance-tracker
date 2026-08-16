import { NextRequest, NextResponse } from "next/server"
import { submitForgeRequest, ForgeSubmitError } from "@/lib/services/forge-intake-service"

// Public, unauthenticated. The visitor is waiting on this response (to show
// the confirmation state), so validation errors are surfaced -- but any
// unexpected failure still degrades to a generic message.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    await submitForgeRequest(body)
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof ForgeSubmitError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 })
    }
    console.error("Forge intake submit error:", error)
    return NextResponse.json({ ok: false, error: "Something went wrong. Please try again." }, { status: 500 })
  }
}
