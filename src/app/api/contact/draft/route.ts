import { NextRequest, NextResponse } from "next/server"
import { saveContactDraft } from "@/lib/services/contact-service"

// Public, unauthenticated autosave beacon -- mirrors api/track/route.ts's
// safety posture exactly: the service whitelists/truncates every field and
// can only ever upsert the visitor's own draft row. Always succeeds from the
// visitor's point of view; autosave must never surface an error on the page.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    await saveContactDraft(body)
  } catch {
    // swallow -- see note above
  }
  return new NextResponse(null, { status: 204 })
}
