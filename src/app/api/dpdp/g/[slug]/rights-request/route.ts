import { NextRequest, NextResponse } from "next/server"
import { getPublicPageBySlug } from "@/lib/services/dpdp-governance-service"
import { raiseRightsRequest } from "@/lib/services/dpdp-principal-service"
import { dpdpErrorResponse } from "@/lib/services/dpdp-route-helpers"

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params
    const page = await getPublicPageBySlug(slug)
    if (!page?.org) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const body = await request.json()
    const created = await raiseRightsRequest({ orgId: page.org.id, kind: body?.kind ?? "access", arrivedVia: "public_page" })
    return NextResponse.json(created, { status: 201 })
  } catch (error) {
    return dpdpErrorResponse(error, "Could not raise that request")
  }
}
