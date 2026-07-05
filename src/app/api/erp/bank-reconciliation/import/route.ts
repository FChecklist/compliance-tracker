import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { importBankStatement, ServiceError } from "@/lib/services/erp-bank-reconciliation-service"

const MAX_FILE_SIZE = 10 * 1024 * 1024

export async function POST(request: NextRequest) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const formData = await request.formData()
    const file = formData.get("file") as File | null
    const bankAccountId = formData.get("bankAccountId") as string | null
    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 })
    if (!bankAccountId) return NextResponse.json({ error: "bankAccountId is required" }, { status: 400 })
    if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: "File too large (max 10 MB)" }, { status: 400 })

    const buffer = Buffer.from(await file.arrayBuffer())
    const imp = await importBankStatement({ orgId, userId: dbUser.id, dbUser }, { bankAccountId, fileName: file.name, buffer, mimeType: file.type })
    return NextResponse.json(imp, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Bank statement import error:", error)
    return NextResponse.json({ error: "Failed to import bank statement" }, { status: 500 })
  }
}
