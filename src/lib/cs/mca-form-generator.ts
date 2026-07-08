// Compiles real, structured, filing-ready data for the four MCA e-forms a
// Company Secretary handles most often -- AOC-4 (financial statements),
// MGT-7 (annual return), DIR-12 (director appointment/cessation
// particulars), CHG-1 (charge creation). Field names follow the public
// MCA/V3 e-form data model (a government spec, not any third party's
// code) -- same "public spec, safe to implement independently" posture as
// the GST return-generator.ts. Pure functions: no DB access, no network --
// callers (mca-filing-service.ts) fetch the source rows and hand them in,
// same separation as return-generator.ts.
export type CompanyParticulars = { cin: string | null; name: string; registeredOfficeAddress: string | null; pan: string | null; entityType: string | null }

export type BalanceSheetInput = { asOfDate: string; totalAssets: number; totalLiabilities: number; totalEquity: number; isBalanced: boolean }
export type ProfitAndLossInput = { fromDate: string; toDate: string; totalIncome: number; totalExpense: number; netProfit: number }

export function generateAoc4(company: CompanyParticulars, financialYear: string, balanceSheet: BalanceSheetInput | null, profitAndLoss: ProfitAndLossInput | null) {
  return {
    formType: "AOC-4",
    financialYear,
    company,
    balanceSheet: balanceSheet ?? { note: "No journal-entry-backed balance sheet available for this org -- enter manually." },
    profitAndLoss: profitAndLoss ?? { note: "No journal-entry-backed P&L available for this org -- enter manually." },
  }
}

export type ShareholderInput = { holderName: string; shares: number; percent: number | null; shareClass: string | null }
export type DirectorInput = { name: string; din: string | null; designation: string | null; isIndependent: boolean; appointedDate: string | null; kycStatus: string | null }
export type ChargeSummaryInput = { chargeHolder: string; chargeType: string | null; amount: number | null; status: string }

export function generateMgt7(
  company: CompanyParticulars, financialYear: string,
  shareholders: ShareholderInput[], directors: DirectorInput[], boardMeetingsHeld: number, charges: ChargeSummaryInput[]
) {
  const totalShares = shareholders.reduce((sum, s) => sum + s.shares, 0)
  return {
    formType: "MGT-7",
    financialYear,
    company,
    shareCapital: { totalShares, shareholders },
    directorsAndKmp: directors,
    boardMeetingsHeld,
    charges,
  }
}

export function generateDir12(company: CompanyParticulars, director: DirectorInput) {
  return {
    formType: "DIR-12",
    company,
    director,
    // A real DIR-12 also needs the specific event (appointment/cessation/
    // change-in-designation) and its date -- not modeled in directors_kmp
    // today (only appointedDate + current status), so this is left for the
    // CS to specify at filing time rather than guessed.
    eventType: null,
    eventDate: null,
  }
}

export function generateChg1(company: CompanyParticulars, charge: ChargeSummaryInput & { createdAt: string; filingReference: string | null }) {
  return {
    formType: "CHG-1",
    company,
    charge: {
      chargeHolder: charge.chargeHolder,
      chargeType: charge.chargeType,
      amountSecured: charge.amount,
      dateOfCreation: charge.createdAt,
      status: charge.status,
      existingFilingReference: charge.filingReference,
    },
  }
}
