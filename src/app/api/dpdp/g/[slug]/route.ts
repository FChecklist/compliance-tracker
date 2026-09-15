// The free public page -- "veridian-aios.com/g/kapoor-exports" in the
// artefact. Public, no session, works for an org with no domain/website
// of its own (that's the entire point of this page existing).
import { NextResponse } from "next/server"
import { getPublicPageBySlug } from "@/lib/services/dpdp-governance-service"
import { dpdpErrorResponse } from "@/lib/services/dpdp-route-helpers"

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params
    const result = await getPublicPageBySlug(slug)
    if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json(result)
  } catch (error) {
    return dpdpErrorResponse(error, "Could not load that page")
  }
}
