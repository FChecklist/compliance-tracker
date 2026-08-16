import { NextRequest, NextResponse } from "next/server"
import { submitContactSubmission, ContactSubmitError } from "@/lib/services/contact-service"

// Public, unauthenticated final submit. Unlike the draft beacon, the visitor
// is waiting on this response (to show the thank-you state), so validation
// errors are surfaced -- but any unexpected failure still degrades to a
// generic error rather than leaking internals.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    await submitContactSubmission(body)
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof ContactSubmitError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 })
    }
    console.error("Contact submit error:", error)
    return NextResponse.json({ ok: false, error: "Something went wrong. Please try again." }, { status: 500 })
  }
}
