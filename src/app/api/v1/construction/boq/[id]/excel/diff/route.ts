// R85 Addendum 3 v4 FINAL, Phase 7 (D89, gates 7-06/7-09/7-10). POST
// .../excel/diff -- uploads a spreadsheet and returns the per-cell diff
// (before/after, counts by column class, rejected rows) WITHOUT writing
// anything (7-06/7-07). Same multipart-upload shape as this codebase's
// existing spreadsheet-import routes (v1/projexa/labour-roster/import,
// v1/projexa/scope/import) -- a "file" field, a 10 MB ceiling.
//
// Role floor: "member"/"write" -- the same floor
// line-items/[id]/route.ts's PATCH already uses for editing a BOQ line's
// budget overlay. A diff writes nothing, but it is one half of a mutating
// workflow (the other half, apply, definitely writes) and previewing it
// requires the same standing to touch this BOQ's data as actually editing
// it would.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { parseUploadedBoq, diffUpload, redactUploadDiffForCostVisibility, ServiceError } from "@/lib/services/boq-excel-roundtrip-service"
import { canRoleSeeCost } from "@/lib/services/cost-visibility-service"
import type { UserRole } from "@/lib/supabase/role-rank"

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB, same ceiling as the sibling roster/scope importers

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })
  const roleErr = requireRoleOrScope(ctx, "member", "write")
  if (roleErr) return roleErr

  try {
    const { id } = await params
    const formData = await request.formData()
    const file = formData.get("file") as File | null
    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 })
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: `File too large. Maximum size is 10 MB. Your file: ${(file.size / 1024 / 1024).toFixed(1)} MB` }, { status: 400 })
    }
    const evidenceRaw = formData.get("evidenceArtefactRef")
    const evidenceArtefactRef = typeof evidenceRaw === "string" && evidenceRaw.trim() !== "" ? evidenceRaw : undefined

    const buffer = Buffer.from(await file.arrayBuffer())
    const parsed = parseUploadedBoq(buffer)
    // 7-10: a malformed file changes nothing -- refused here, before any row
    // is read against the database.
    if (parsed.fileErrors.length > 0) {
      return NextResponse.json({ error: "Malformed file -- nothing was read.", fileErrors: parsed.fileErrors }, { status: 400 })
    }

    const diff = await diffUpload({ orgId: ctx.orgId }, id, parsed.rows, { evidenceArtefactRef, contentHash: parsed.contentHash })
    const role = (ctx.dbUser?.role as UserRole | undefined) ?? null
    const canSeeCost = await canRoleSeeCost({ orgId: ctx.orgId }, role)
    return NextResponse.json(redactUploadDiffForCostVisibility(diff, canSeeCost))
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction BOQ excel diff error:", error)
    return NextResponse.json({ error: "Failed to diff the uploaded BOQ spreadsheet" }, { status: 500 })
  }
}
