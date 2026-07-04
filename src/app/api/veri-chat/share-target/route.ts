// Backs the PWA Web Share Target (see public/manifest.json's share_target
// entry) -- the receiving half of §16.2's research finding: WhatsApp/
// Telegram/any app's native OS Share Sheet can deliver text directly here
// (e.g. after a user taps WhatsApp's own "Export Chat" and picks VERIDIAN
// AI from the share sheet), which is the only real way content moves OUT
// of those apps -- no web link can pull an existing chat out on its own.
// The Web Share Target spec posts multipart/form-data with title/text/url
// fields, whichever the sharing app populated.
import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { importSharedContent, ServiceError } from "@/lib/services/veri-chat-service"

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const form = await request.formData()
    const title = (form.get("title") as string) || ""
    const text = (form.get("text") as string) || ""
    const url = (form.get("url") as string) || ""
    const combined = [title, text, url].filter(Boolean).join("\n\n")

    const result = await importSharedContent({ orgId, userId: dbUser.id }, { text: combined, sourcePlatform: "share_target" })
    const redirectUrl = new URL(`/chat?conversation=${result.conversationId}`, request.url)
    return NextResponse.redirect(redirectUrl, { status: 303 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("VERI Chat share target error:", error)
    return NextResponse.json({ error: "Failed to import shared content" }, { status: 500 })
  }
}
