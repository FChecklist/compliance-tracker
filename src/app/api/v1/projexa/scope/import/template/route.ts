// R67 D-25: the "Download template" the BOQ import screen offers. Served from
// HERE, not built in PROJEXA, for the same reason the preview is parsed here:
// PROJEXA must not gain an XLSX library, so it relays these bytes.
//
// The template's columns are exactly the ones the importer's own alias table
// (construction-boq-import-service.ts's BOQ_FIELD_ALIASES) recognises, and the
// example rows show the one thing a BOQ spreadsheet gets wrong most often -- a
// sub-task, which carries a Parent Item Code and a Breakdown % and leaves Qty
// and Rate blank, because the importer derives those from the parent.
import { NextRequest, NextResponse } from "next/server"
import { requireAuthOrApiKey } from "@/lib/supabase/auth-guard"
import { rowsToXLSXBuffer, type ExportRow } from "@/lib/report-export-shared"

export const TEMPLATE_ROWS: ExportRow[] = [
  {
    Category: "Gypsum",
    "Item Code": "1",
    Description: "Gypsum partition - 100mm",
    Unit: "sqm",
    Qty: 472,
    Rate: 108,
    "Parent Item Code": "",
    "Breakdown %": "",
  },
  {
    Category: "Gypsum",
    "Item Code": "1.1",
    Description: "Frame",
    Unit: "sqm",
    Qty: "",
    Rate: "",
    "Parent Item Code": "1",
    "Breakdown %": 30,
  },
  {
    Category: "Paint",
    "Item Code": "2",
    Description: "Two coats emulsion - internal walls",
    Unit: "sqm",
    Qty: 860,
    Rate: 14,
    "Parent Item Code": "",
    "Breakdown %": "",
  },
]

export async function GET(request: NextRequest) {
  const ctx = await requireAuthOrApiKey(request)
  if (ctx.response) return ctx.response
  if (!ctx.orgId) return NextResponse.json({ error: "No organisation on this account" }, { status: 400 })

  try {
    const buffer = rowsToXLSXBuffer(TEMPLATE_ROWS, "BOQ")
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="boq-import-template.xlsx"',
        "Cache-Control": "no-store",
      },
    })
  } catch (error) {
    console.error("v1 projexa scope import template error:", error)
    return NextResponse.json({ error: "Failed to build the BOQ import template" }, { status: 500 })
  }
}
