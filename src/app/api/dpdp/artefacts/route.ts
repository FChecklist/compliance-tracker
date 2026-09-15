import { NextRequest, NextResponse } from "next/server"
import { requireDpdpSession } from "@/lib/services/dpdp-session"
import { uploadArtefact, listArtefactsForObligation } from "@/lib/services/dpdp-artefact-service"
import { dpdpErrorResponse } from "@/lib/services/dpdp-route-helpers"

export async function GET(request: Request) {
  const result = await requireDpdpSession()
  if ("response" in result) return result.response
  const obligationId = new URL(request.url).searchParams.get("obligationId")
  if (!obligationId) return NextResponse.json({ error: "obligationId is required" }, { status: 400 })
  try {
    const artefacts = await listArtefactsForObligation(result.ctx.orgId, obligationId)
    return NextResponse.json({ artefacts })
  } catch (error) {
    return dpdpErrorResponse(error, "Could not load evidence")
  }
}

// Metadata only -- the actual file bytes go through this app's existing
// document-storage path (out of scope for this route); this records the
// bitemporal facts about a file that already has somewhere to live.
export async function POST(request: NextRequest) {
  const result = await requireDpdpSession()
  if ("response" in result) return result.response
  try {
    const body = await request.json()
    const artefact = await uploadArtefact({
      orgId: result.ctx.orgId, uploadedBy: result.ctx.identityId, obligationId: body?.obligationId ?? "",
      filename: body?.filename ?? "", mime: body?.mime, sizeBytes: body?.sizeBytes, sha256: body?.sha256,
      tActivity: body?.tActivity ? new Date(body.tActivity) : undefined,
      tDocumentStated: body?.tDocumentStated ? new Date(body.tDocumentStated) : undefined,
      tExif: body?.tExif ? new Date(body.tExif) : undefined,
      tFileModified: body?.tFileModified ? new Date(body.tFileModified) : undefined,
      device: body?.device, geo: body?.geo,
    })
    return NextResponse.json(artefact, { status: 201 })
  } catch (error) {
    return dpdpErrorResponse(error, "Could not record that upload")
  }
}
