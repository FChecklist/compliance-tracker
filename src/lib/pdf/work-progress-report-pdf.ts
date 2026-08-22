// Point 138: VERIDIAN's own Work Progress Report PDF -- point 117 (projexa)
// has been waiting on this; there was nothing to relay because this
// endpoint didn't exist. Modeled on meeting-minutes-pdf.ts's shape (a pure
// function over a plain data object, returning ArrayBuffer, independently
// unit-testable without a DB/tenant-context dependency), using
// pdf-generator.ts's shared branded-document helpers the same way
// payroll/payslips/[id]/pdf/route.ts already does.
//
// Computes each BoQ line item's OWN directly-recorded Previous/Current/
// Total-or-Balance progress -- the same base per-line formula projexa's
// work-progress-report.ts's computeLineItemProgress uses (sum of progress
// entries before/within [from, to], amount = qty * rate, percentage = amt /
// this line's own BoQ amount, balance = original BoQ total - total).
// Deliberately NOT the hierarchical weighted-parent-rollup step
// (applyWeightedParentRollup in that same file): that arithmetic already
// exists there, and re-deriving it here would create two sources of truth
// for the same number (this point's own do_not_assume forbids it). A
// hierarchical parent line (one with children) therefore shows its own
// directly-recorded progress only in this PDF -- typically 0, since a real
// hierarchical parent rarely receives progress entries itself; see
// work-progress-report.ts's own comment on why sub-task rows carry the
// real recorded quantity instead. A disclosed, genuine report limitation,
// not a bug -- and orthogonal to WPR-06 (percentages blank for children),
// which this generator DOES implement, since that's a display rule, not
// arithmetic.
import { createBrandedDocument, drawDocumentHeader, drawSectionLabel, drawFooterNote, pdfToBuffer, autoTable } from "@/lib/pdf-generator"

export type WprPdfLineItem = {
  // R12 point 7 (Option B): already present on getBoq()'s real row (every
  // constructionBoqLineItems select carries `id`), just never declared on
  // this local type before -- same "on the wire, invisible to TypeScript"
  // situation parentLineItemId was in until it got added below. Needed now
  // so computeRows() can match an entry's boq_line_item_id back to this
  // line's own id.
  id: string
  itemCode: string | null
  description: string
  unit: string
  quantity: string | number
  rate: string | number
  amount: string | number
  activityId: string | null
  parentLineItemId: string | null
  // Rate-buildup-derived rate (material+labour+equipment+overhead+profit),
  // when construction-boq-service.ts's getBoq() computed one -- same
  // preference order projexa's own work-progress-report.ts uses
  // (`line.computedRate ?? num(line.rate)`), null when no cost-component
  // fields are set on this line (a plain quoted-rate BoQ item).
  computedRate?: number | null
}
export type WprPdfActivity = { id: string; categoryId: string; name: string }
export type WprPdfCategory = { id: string; name: string }
export type WprPdfEntry = {
  activityId: string
  // R12 point 7 (Option B, drizzle/0315): optional direct link to the BOQ
  // line the progress is actually against -- same field
  // construction_work_progress_entries.boq_line_item_id carries and
  // listProgressEntries() already returns on the wire, just never declared
  // on this local type before. null for every pre-Option-B entry, which
  // keeps matching by activityId exactly as before -- see computeRows()'s
  // preference order.
  boqLineItemId?: string | null
  entryDate: string
  quantityDone: string | number
}

export type WorkProgressReportPdfData = {
  org: { name: string; address: string | null; gstin: string | null }
  projectName: string
  boqTitle: string | null
  from: string
  to: string
  lineItems: WprPdfLineItem[]
  activities: WprPdfActivity[]
  categories: WprPdfCategory[]
  entries: WprPdfEntry[]
  // Point 11's toggle, extended to the printed report -- a static document
  // can't be interactive, so it picks the one reading the caller asked for
  // (?mode= on the route; defaults to "total"). Never both stored, nothing
  // persisted -- computed fresh on every call, same as the screen version.
  mode?: "total" | "balance"
}

function num(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

function money(n: number): string {
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export type ComputedRow = {
  code: string
  description: string
  categoryName: string
  isChild: boolean // WPR-06: a hierarchical BoQ sub-task -- percent cells render blank
  prevQty: number; currentQty: number; thirdQty: number
  prevAmt: number; currentAmt: number; thirdAmt: number
  prevPct: number; currentPct: number; thirdPct: number
}

// Exported (not just used internally) so its Previous/Current/Total-or-
// Balance arithmetic and WPR-06 child-blanking are independently unit-
// testable with real assertions -- byte-level PDF output can only ever
// prove "a document exists," not "the numbers in it are right."
export function computeRows(data: WorkProgressReportPdfData, mode: "total" | "balance"): ComputedRow[] {
  const activitiesById = new Map(data.activities.map((a) => [a.id, a]))
  const categoriesById = new Map(data.categories.map((c) => [c.id, c]))

  return data.lineItems.map((line) => {
    const rate = line.computedRate ?? num(line.rate)
    const qtyTotalBoq = num(line.quantity)
    const amtTotalBoq = num(line.amount) || qtyTotalBoq * rate

    const activity = line.activityId ? activitiesById.get(line.activityId) : undefined
    const category = activity ? categoriesById.get(activity.categoryId) : undefined

    // R12 point 7 (Option B): preference-order entry-to-line resolution --
    // an entry carrying boq_line_item_id is claimed EXCLUSIVELY by the line
    // it names (never also falls through to the activityId rule below, for
    // this line or any other -- that would count the same entry twice
    // under two different rules). Only entries with no boq_line_item_id at
    // all still resolve by activityId, exactly as before -- today's
    // behavior, unchanged, for every line/entry that predates Option B. No
    // more `line.activityId ?` guard: a line with no activityId can still
    // have real Option-B entries keyed by boq_line_item_id.
    const matches = data.entries.filter((e) =>
      e.boqLineItemId ? e.boqLineItemId === line.id : line.activityId !== null && e.activityId === line.activityId
    )
    const prevQty = matches.filter((e) => e.entryDate < data.from).reduce((s, e) => s + num(e.quantityDone), 0)
    const currentQty = matches.filter((e) => e.entryDate >= data.from && e.entryDate <= data.to).reduce((s, e) => s + num(e.quantityDone), 0)
    const totalQty = prevQty + currentQty
    const balanceQty = qtyTotalBoq - totalQty

    const prevAmt = prevQty * rate
    const currentAmt = currentQty * rate
    const totalAmt = totalQty * rate
    const balanceAmt = amtTotalBoq - totalAmt

    const pct = (amt: number) => (amtTotalBoq > 0 ? Math.round((amt / amtTotalBoq) * 10000) / 100 : 0)
    const totalPct = pct(totalAmt)
    const balancePct = pct(balanceAmt)

    return {
      code: line.itemCode ?? "",
      description: line.description,
      categoryName: category?.name ?? "Uncategorized",
      isChild: !!line.parentLineItemId,
      prevQty, currentQty, thirdQty: mode === "balance" ? balanceQty : totalQty,
      prevAmt, currentAmt, thirdAmt: mode === "balance" ? balanceAmt : totalAmt,
      prevPct: pct(prevAmt), currentPct: pct(currentAmt), thirdPct: mode === "balance" ? balancePct : totalPct,
    }
  })
}

export function generateWorkProgressReportPdf(data: WorkProgressReportPdfData): ArrayBuffer {
  const mode = data.mode ?? "total"
  const thirdLabel = mode === "balance" ? "Balance" : "Total"

  const doc = createBrandedDocument({ orientation: "l" }) // landscape -- nine data columns need the width
  let y = drawDocumentHeader(doc, {
    orgName: data.org.name,
    orgAddress: data.org.address,
    orgGstin: data.org.gstin,
    documentTitle: "Work Progress Report",
    documentSubtitle: `${data.projectName} · ${data.from} to ${data.to}`,
  })
  y += 16

  if (data.boqTitle) {
    doc.setFontSize(9)
    doc.setTextColor(100, 100, 100)
    doc.setFont("helvetica", "normal")
    doc.text(`BoQ: ${data.boqTitle}`, 32, y)
    y += 18
  }

  const rows = computeRows(data, mode)

  drawSectionLabel(doc, "Scope-wise Progress", 32, y)
  y += 8

  if (rows.length === 0) {
    // Point 138 gate3(c): a project with zero BoQ line items / zero
    // progress entries is a legitimate answer, not an error -- the E-52
    // pattern (conflating "nothing to show" with "something went wrong")
    // has bitten this codebase before. Still a valid PDF, not a 4xx.
    doc.setFont("helvetica", "italic")
    doc.setFontSize(10)
    doc.setTextColor(100, 100, 100)
    doc.text("No BoQ line items with recorded progress for this project in this date range.", 32, y + 14)
    doc.setFont("helvetica", "normal")
    doc.setTextColor(28, 43, 58)
  } else {
    autoTable(doc, {
      startY: y,
      head: [[
        "Code", "Description", "Category",
        "% Previous", "% Current", `% ${thirdLabel}`,
        "Qty Previous", "Qty Current", `Qty ${thirdLabel}`,
        "Amt Previous", "Amt Current", `Amt ${thirdLabel}`,
      ]],
      body: rows.map((r) => [
        r.code || "—", r.description, r.categoryName,
        r.isChild ? "" : `${r.prevPct}%`, r.isChild ? "" : `${r.currentPct}%`, r.isChild ? "" : `${r.thirdPct}%`,
        money(r.prevQty), money(r.currentQty), money(r.thirdQty),
        money(r.prevAmt), money(r.currentAmt), money(r.thirdAmt),
      ]),
      margin: { left: 32, right: 32 },
      headStyles: { fillColor: "#1C2B3A", textColor: "#FFFFFF", fontStyle: "bold", fontSize: 8 },
      styles: { fontSize: 8, cellPadding: 4 },
      columnStyles: {
        3: { halign: "right" }, 4: { halign: "right" }, 5: { halign: "right" },
        6: { halign: "right" }, 7: { halign: "right" }, 8: { halign: "right" },
        9: { halign: "right" }, 10: { halign: "right" }, 11: { halign: "right" },
      },
    })

    const noteY = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 40) + 16
    doc.setFont("helvetica", "italic")
    doc.setFontSize(7.5)
    doc.setTextColor(100, 100, 100)
    doc.text(
      "Percentages are shown for parent scope lines only -- a hierarchical BoQ sub-task's own percentage is left blank here.",
      32, noteY
    )
    doc.setFont("helvetica", "normal")
    doc.setTextColor(28, 43, 58)
  }

  drawFooterNote(doc, "Generated by VERIDIAN AI OS · Work Progress Report")

  return pdfToBuffer(doc)
}
