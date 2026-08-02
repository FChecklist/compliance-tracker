import { NextRequest, NextResponse, after } from "next/server"
import { requireAuth, requireRole } from "@/lib/supabase/auth-guard"
import { createClient } from "@supabase/supabase-js"
import { createId } from "@paralleldrive/cuid2"
import {
  createVoiceMemo, listVoiceMemos, transcribeAndExtractVoiceMemo, ServiceError,
} from "@/lib/services/voice-ticket-service"
import { WHISPER_MAX_BYTES } from "@/lib/whisper-client"

// Priority 14 Wave 2 (GAP-MOM-VOICE-TICKETS). Mirrors
// src/app/api/documents/route.ts's own upload pattern exactly (private
// service-role-only Storage bucket, requireAuth() + requireRole("member")
// gate, DB row inside withTenantContext via the service layer, fire-and-
// forget AI work wrapped in after() so Vercel's serverless runtime can't
// kill it the instant the response is sent -- the same real bug documents'
// own upload route and veri-meeting-service.ts's publishVeriMeeting both
// had to fix before this).
const BUCKET = "voice-memos"

function getStorageAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120)
}

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  const roleErr = requireRole(dbUser, "member")
  if (roleErr) return roleErr
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const formData = await request.formData()
    const file = formData.get("file")
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "An audio file is required" }, { status: 400 })
    }
    if (file.size > WHISPER_MAX_BYTES) {
      return NextResponse.json({ error: "Audio file exceeds OpenAI Whisper's 25 MB limit" }, { status: 400 })
    }
    if (file.size === 0) {
      return NextResponse.json({ error: "Audio file is empty" }, { status: 400 })
    }

    const meetingId = (formData.get("meetingId") as string | null) || null
    const durationRaw = (formData.get("durationSeconds") as string | null) || null
    const durationSeconds = durationRaw ? Number.parseInt(durationRaw, 10) : null

    const objectPath = orgId + "/" + createId() + "-" + sanitizeFileName(file.name || "voice-memo.webm")
    const bytes = new Uint8Array(await file.arrayBuffer())
    const mimeType = file.type || "audio/webm"

    const admin = getStorageAdminClient()
    const { error: uploadError } = await admin.storage.from(BUCKET).upload(objectPath, bytes, {
      contentType: mimeType,
      upsert: false,
    })
    if (uploadError) {
      console.error("Voice memo storage upload error:", uploadError)
      return NextResponse.json({ error: "Failed to upload audio file" }, { status: 500 })
    }

    const memo = await createVoiceMemo({ orgId, userId: dbUser.id, dbUser }, {
      meetingId, audioStoragePath: objectPath, audioMimeType: mimeType,
      durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : null,
    })

    // Fire-and-forget transcription + extraction -- never blocks or fails
    // the upload response. Reuses the bytes already read above rather than
    // re-downloading from Storage. Wrapped in after(), not a bare
    // .catch()'d promise -- see this file's own header comment for why.
    after(() =>
      transcribeAndExtractVoiceMemo({ orgId, userId: dbUser.id, dbUser }, memo!.id, bytes, file.name || "voice-memo.webm", mimeType).catch((err) =>
        console.error("Voice memo transcription/extraction failed (recorded on the row, not silently dropped):", err)
      )
    )

    return NextResponse.json({
      id: memo!.id, status: memo!.status, meetingId: memo!.meetingId, createdAt: memo!.createdAt.toISOString(),
    }, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Voice memo upload error:", error)
    return NextResponse.json({ error: "Failed to upload voice memo" }, { status: 500 })
  }
}

export async function GET() {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ voiceMemos: [] })

  try {
    const memos = await listVoiceMemos({ orgId })
    return NextResponse.json({ voiceMemos: memos })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Voice memo list error:", error)
    return NextResponse.json({ error: "Failed to fetch voice memos" }, { status: 500 })
  }
}
