import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"
import { processPayrollRun, ServiceError } from "@/lib/services/erp-payroll-service"

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { response, dbUser, orgId } = await requireAuth()
  if (response) return response
  if (!orgId || !dbUser) return NextResponse.json({ error: "No organisation found" }, { status: 400 })

  try {
    const { id } = await params
    const result = await processPayrollRun({ orgId, userId: dbUser.id, dbUser }, id)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Payroll run process error:", error)
    return NextResponse.json({ error: "Failed to process payroll run" }, { status: 500 })
  }
}
