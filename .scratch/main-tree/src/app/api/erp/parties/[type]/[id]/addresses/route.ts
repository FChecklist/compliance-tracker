import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listAddresses, addAddress, ServiceError } from "@/lib/services/erp-party-service"

export async function GET(_request: NextRequest, { params }: { params: Promise<{ type: string; id: string }> }) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ addresses: [] })

  try {
    const { type, id } = await params
    const addresses = await listAddresses({ orgId }, type, id)
    return NextResponse.json({ addresses })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Addresses list error:", error)
    return NextResponse.json({ error: "Failed to fetch addresses" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ type: string; id: string }> }) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { type, id } = await params
    const body = await request.json()
    const address = await addAddress({ orgId }, type, id, body)
    return NextResponse.json(address, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Address create error:", error)
    return NextResponse.json({ error: "Failed to add address" }, { status: 500 })
  }
}
