import { NextRequest, NextResponse } from "next/server"
import { submitBankAccountViaPortal, ServiceError } from "@/lib/services/erp-vendor-master-service"

// Public route (no auth) -- vendor self-service submission of a new bank
// account through their portal token. See submitBankAccountViaPortal()'s
// own comment for why isPrimary is never accepted from this path.
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const body = await request.json()
    const account = await submitBankAccountViaPortal(token, {
      accountHolderName: body.accountHolderName, bankName: body.bankName, accountNumber: body.accountNumber,
      ifscCode: body.ifscCode, accountType: body.accountType,
    })
    return NextResponse.json(account, { status: 201 })
  } catch (error) {
    if (error instanceof ServiceError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error("Vendor portal bank account submission error:", error)
    return NextResponse.json({ error: "Failed to submit bank account" }, { status: 500 })
  }
}
