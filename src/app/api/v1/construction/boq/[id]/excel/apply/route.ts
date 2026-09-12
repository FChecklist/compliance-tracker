// R85 Addendum 3 v4 FINAL, Phase 7 (D89, gates 7-05/7-06/7-07/7-08/7-09).
// POST .../excel/apply -- uploads the SAME file the caller just diffed,
// plus the confirmedDiffToken that diff returned, and actually writes.
// applyUpload() itself re-diffs fresh and refuses (409) on any token
// mismatch (7-06/X-20: an apply must be of the diff that was actually
// shown) -- this route does not trust the client's own copy of the diff for
// anything beyond that token.
//
// evidenceArtefactRef is a real, human-cited business document (a variation
// order, an amendment email, a PO) -- required only when this BOQ already
// has a confirmed baseline AND the upload changes a contract-side cell
// (7-05); the uploaded FILE's own content hash (parsed.contentHash) is
// always recorded as the evidence for every OTHER change it made (7-08),
// separate from this field.
//
// Role floor: "member"/"write", same as the diff route and the sibling
// line-items/[id]/route.ts PATCH.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey, requireRoleOrScope } from "@/lib/supabase/auth-guard"
import { parseUploadedBoq, applyUpload, ServiceError } from "@/lib/services/boq-excel-roundtrip-service"

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB, same ceiling as the sibling roster/scope importers and this feature's own diff route

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
    const confirmedDiffToken = formData.get("confirmedDiffToken")
    if (typeof confirmedDiffToken !== "string" || confirmedDiffToken.trim() === "") {
      return NextResponse.json({ error: "confirmedDiffToken is required -- run POST .../excel/diff first and pass back the token it returns. Nothing was applied." }, { status: 400 })
    }
    const evidenceRaw = formData.get("evidenceArtefactRef")
    const evidenceArtefactRef = typeof evidenceRaw === "string" && evidenceRaw.trim() !== "" ? evidenceRaw : undefined

    const buffer = Buffer.from(await file.arrayBuffer())
    const parsed = parseUploadedBoq(buffer)
    // 7-10: a malformed file changes nothing.
    if (parsed.fileErrors.length > 0) {
      return NextResponse.json({ error: "Malformed file -- nothing was applied.", fileErrors: parsed.fileErrors }, { status: 400 })
    }

    // External API-key callers have no real user id -- same fallback
    // v1/construction/boq/route.ts's own POST already uses for createBoq's
    // createdById, reused here for createBoqRevision's identical need.
    const actorId = ctx.dbUser?.id ?? ctx.apiKey!.id
    const result = await applyUpload(
      { orgId: ctx.orgId, userId: actorId },
      id,
      parsed.rows,
      { evidenceArtefactRef, confirmedDiffToken, contentHash: parsed.contentHash }
    )

    // No cost-visibility redaction needed here (unlike the diff route):
    // ApplyUploadResult carries no per-cell array of raw cost figures --
    // `changesApplied` is a bare count and `contractChangesPendingEvidence`
    // is contract-side only (always visible, per cost-visibility-service.ts).
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("v1 construction BOQ excel apply error:", error)
    return NextResponse.json({ error: "Failed to apply the uploaded BOQ spreadsheet" }, { status: 500 })
  }
}
