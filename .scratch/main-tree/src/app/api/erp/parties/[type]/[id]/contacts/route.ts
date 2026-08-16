import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { listContacts, addContact, ServiceError } from "@/lib/services/erp-party-service"

export async function GET(_request: NextRequest, { params }: { params: Promise<{ type: string; id: string }> }) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ contacts: [] })

  try {
    const { type, id } = await params
    const contacts = await listContacts({ orgId }, type, id)
    return NextResponse.json({ contacts })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Contacts list error:", error)
    return NextResponse.json({ error: "Failed to fetch contacts" }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ type: string; id: string }> }) {
  const { response, orgId } = await requireAuth()
  if (response) return response
  if (!orgId) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { type, id } = await params
    const body = await request.json()
    const contact = await addContact({ orgId }, type, id, body)
    return NextResponse.json(contact, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Contact create error:", error)
    return NextResponse.json({ error: "Failed to add contact" }, { status: 500 })
  }
}
