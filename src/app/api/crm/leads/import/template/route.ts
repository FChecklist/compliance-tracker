// VERIDIAN Review Framework gap-closure, "Data Import/Export Template
// Fidelity": the downloadable template for the import above -- header row
// matches importLeadsCsv()'s HEADER_MAP exactly, plus one example row.
import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/supabase/auth-guard"

const TEMPLATE = [
  "name,email,phone,source,owner id,company id,next action date,next action note",
  "Acme Retail Pvt Ltd,founder@acme.com,+91 98765 43210,Referral,,,2026-08-15,Follow up on proposal",
].join("\n")

export async function GET() {
  const { response } = await requireAuth()
  if (response) return response
  return new NextResponse(TEMPLATE, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-import-template.csv"`,
    },
  })
}
