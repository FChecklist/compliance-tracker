// Compiles real filing-ready data for an existing mca_filings row, sourced
// from directors_kmp/cap_table_entries/company_charges/board_meetings and
// (for AOC-4) the ERP balance-sheet/P&L engine -- see mca-form-generator.ts
// for the pure form-shaping functions and the honest submission-boundary
// note on mcaFilings in schema.ts (this compiles data, it never files
// anything with the MCA).
import { mcaFilings, organisations, directorsKmp, capTableEntries, companyCharges, boardMeetings } from "@/lib/db"
import { withTenantContext } from "@/lib/db/tenant-scoped"
import { and, eq, gte, lte } from "drizzle-orm"
import { ServiceError } from "./compliance-service"
export { ServiceError }
import { balanceSheet, profitAndLoss } from "./erp-financial-report-service"
import { generateAoc4, generateMgt7, generateDir12, generateChg1, type CompanyParticulars, type DirectorInput, type ChargeSummaryInput } from "@/lib/cs/mca-form-generator"

export type GenerateFormDataInput = {
  financialYearStart?: string // YYYY-MM-DD, required for AOC-4/MGT-7
  financialYearEnd?: string
  directorId?: string // required for DIR-12
  chargeId?: string // required for CHG-1/CHG-4
}

async function loadCompanyParticulars(orgId: string): Promise<CompanyParticulars> {
  return withTenantContext({ orgId }, async (db) => {
    const org = await db.query.organisations.findFirst({ where: eq(organisations.id, orgId) })
    if (!org) throw new ServiceError("Organisation not found", 404)
    return { cin: org.cinNumber, name: org.name, registeredOfficeAddress: org.address, pan: org.panNumber, entityType: org.entityType }
  })
}

export async function generateFormData(ctx: { orgId: string }, filingId: string, input: GenerateFormDataInput) {
  return withTenantContext({ orgId: ctx.orgId }, async (db) => {
    const filing = await db.query.mcaFilings.findFirst({ where: and(eq(mcaFilings.id, filingId), eq(mcaFilings.orgId, ctx.orgId)) })
    if (!filing) throw new ServiceError("MCA filing not found", 404)

    const company = await loadCompanyParticulars(ctx.orgId)
    const formTypeUpper = filing.formType.trim().toUpperCase()
    let formData: unknown

    if (formTypeUpper === "AOC-4") {
      if (!input.financialYearStart || !input.financialYearEnd) throw new ServiceError("financialYearStart and financialYearEnd are required for AOC-4", 400)
      const [bs, pl] = await Promise.all([
        balanceSheet({ orgId: ctx.orgId }, input.financialYearEnd).catch(() => null),
        profitAndLoss({ orgId: ctx.orgId }, input.financialYearStart, input.financialYearEnd).catch(() => null),
      ])
      formData = generateAoc4(
        company, `${input.financialYearStart} to ${input.financialYearEnd}`,
        bs ? { asOfDate: bs.asOfDate, totalAssets: bs.totalAssets, totalLiabilities: bs.totalLiabilities, totalEquity: bs.totalEquity, isBalanced: bs.isBalanced } : null,
        pl ? { fromDate: pl.fromDate, toDate: pl.toDate, totalIncome: pl.totalIncome, totalExpense: pl.totalExpense, netProfit: pl.netProfit } : null
      )
    } else if (formTypeUpper === "MGT-7" || formTypeUpper === "MGT-7A") {
      if (!input.financialYearStart || !input.financialYearEnd) throw new ServiceError("financialYearStart and financialYearEnd are required for MGT-7", 400)
      const [shareholderRows, directorRows, chargeRows, meetingsHeld] = await Promise.all([
        db.query.capTableEntries.findMany({ where: eq(capTableEntries.orgId, ctx.orgId) }),
        db.query.directorsKmp.findMany({ where: eq(directorsKmp.orgId, ctx.orgId) }),
        db.query.companyCharges.findMany({ where: eq(companyCharges.orgId, ctx.orgId) }),
        db.query.boardMeetings.findMany({
          where: and(eq(boardMeetings.orgId, ctx.orgId), eq(boardMeetings.status, "held"), gte(boardMeetings.meetingDate, new Date(input.financialYearStart)), lte(boardMeetings.meetingDate, new Date(input.financialYearEnd))),
        }),
      ])
      const shareholders = shareholderRows.map(s => ({ holderName: s.holderName, shares: s.shares, percent: s.percent != null ? Number(s.percent) : null, shareClass: s.shareClass }))
      const directors: DirectorInput[] = directorRows.map(d => ({ name: d.name, din: d.din, designation: d.designation, isIndependent: d.isIndependent, appointedDate: d.appointedDate?.toISOString().slice(0, 10) ?? null, kycStatus: d.kycStatus }))
      const charges: ChargeSummaryInput[] = chargeRows.map(c => ({ chargeHolder: c.chargeHolder, chargeType: c.chargeType, amount: c.amount != null ? Number(c.amount) : null, status: c.status }))
      formData = generateMgt7(company, `${input.financialYearStart} to ${input.financialYearEnd}`, shareholders, directors, meetingsHeld.length, charges)
    } else if (formTypeUpper === "DIR-12" || formTypeUpper === "DIR-3") {
      if (!input.directorId) throw new ServiceError("directorId is required for DIR-12/DIR-3", 400)
      const director = await db.query.directorsKmp.findFirst({ where: and(eq(directorsKmp.id, input.directorId), eq(directorsKmp.orgId, ctx.orgId)) })
      if (!director) throw new ServiceError("Director not found", 404)
      formData = generateDir12(company, { name: director.name, din: director.din, designation: director.designation, isIndependent: director.isIndependent, appointedDate: director.appointedDate?.toISOString().slice(0, 10) ?? null, kycStatus: director.kycStatus })
    } else if (formTypeUpper === "CHG-1" || formTypeUpper === "CHG-4") {
      if (!input.chargeId) throw new ServiceError("chargeId is required for CHG-1/CHG-4", 400)
      const charge = await db.query.companyCharges.findFirst({ where: and(eq(companyCharges.id, input.chargeId), eq(companyCharges.orgId, ctx.orgId)) })
      if (!charge) throw new ServiceError("Charge not found", 404)
      formData = generateChg1(company, {
        chargeHolder: charge.chargeHolder, chargeType: charge.chargeType, amount: charge.amount != null ? Number(charge.amount) : null,
        status: charge.status, createdAt: charge.createdAt.toISOString().slice(0, 10), filingReference: charge.filingReference,
      })
    } else {
      throw new ServiceError(`No form-data generator implemented for form type "${filing.formType}" -- supported: AOC-4, MGT-7, DIR-12/DIR-3, CHG-1/CHG-4`, 400)
    }

    const [updated] = await db.update(mcaFilings).set({ formData, generatedAt: new Date(), updatedAt: new Date() }).where(eq(mcaFilings.id, filingId)).returning()
    return updated
  })
}
