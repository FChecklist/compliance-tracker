// VCEL Banking Engine (computation_engines: emi_calculator, loan_schedule_generator,
// amortization_engine). Standard reducing-balance EMI formula -- deterministic, no LLM.
import Decimal from "decimal.js"

export type EmiInput = { principal: number; annualRatePercent: number; tenureMonths: number }
export type AmortizationRow = { month: number; emi: number; principalPaid: number; interestPaid: number; balance: number }
export type EmiResult = { emi: number; totalInterest: number; totalPayment: number; schedule: AmortizationRow[] }

export function calculateEmi(input: EmiInput): EmiResult {
  const { principal, annualRatePercent, tenureMonths } = input
  if (principal <= 0) throw new Error("principal must be positive")
  if (tenureMonths <= 0 || !Number.isInteger(tenureMonths)) throw new Error("tenureMonths must be a positive integer")
  if (annualRatePercent < 0) throw new Error("annualRatePercent must be non-negative")

  const P = new Decimal(principal)
  const n = tenureMonths

  // Zero-interest loan: EMI is just an even principal split.
  if (annualRatePercent === 0) {
    const emi = P.div(n)
    let balance = P
    const schedule: AmortizationRow[] = []
    for (let month = 1; month <= n; month++) {
      const principalPaid = month === n ? balance : emi
      balance = balance.minus(principalPaid)
      schedule.push({ month, emi: round2(emi), principalPaid: round2(principalPaid), interestPaid: 0, balance: round2(balance) })
    }
    return { emi: round2(emi), totalInterest: 0, totalPayment: round2(P), schedule }
  }

  const r = new Decimal(annualRatePercent).div(1200) // monthly rate
  const onePlusR_n = r.plus(1).pow(n)
  const emi = P.mul(r).mul(onePlusR_n).div(onePlusR_n.minus(1))

  let balance = P
  const schedule: AmortizationRow[] = []
  let totalInterest = new Decimal(0)
  for (let month = 1; month <= n; month++) {
    const interestPaid = balance.mul(r)
    let principalPaid = emi.minus(interestPaid)
    if (month === n) principalPaid = balance // absorb rounding on final installment
    balance = balance.minus(principalPaid)
    totalInterest = totalInterest.plus(interestPaid)
    schedule.push({ month, emi: round2(emi), principalPaid: round2(principalPaid), interestPaid: round2(interestPaid), balance: round2(balance.abs().lt(0.01) ? new Decimal(0) : balance) })
  }

  return {
    emi: round2(emi),
    totalInterest: round2(totalInterest),
    totalPayment: round2(P.plus(totalInterest)),
    schedule,
  }
}

function round2(d: Decimal): number {
  return d.toDecimalPlaces(2).toNumber()
}

// Interest Calculator (Banking) -- simple or compound, on a savings/deposit balance
export function calculateBankingInterest(principal: number, annualRatePercent: number, days: number, method: "simple" | "compound_daily" = "simple"): number {
  if (method === "simple") return round2(new Decimal(principal).mul(annualRatePercent).div(100).mul(days).div(365))
  const dailyRate = new Decimal(annualRatePercent).div(100).div(365)
  const amount = new Decimal(principal).mul(dailyRate.plus(1).pow(days))
  return round2(amount.minus(principal))
}

// Cash Flow Projection -- rolls forward an opening balance through a list of expected in/outflows
export function projectCashFlow(openingBalance: number, movements: { date: string; amount: number }[]): { date: string; amount: number; runningBalance: number }[] {
  let balance = new Decimal(openingBalance)
  return movements.map((m) => {
    balance = balance.plus(m.amount)
    return { date: m.date, amount: m.amount, runningBalance: round2(balance) }
  })
}

// Outstanding Cheque Engine -- cheques issued/received but not yet cleared as of a cutoff date
export function findOutstandingCheques(cheques: { id: string; issueDate: string; clearedDate?: string }[], asOfDate: string): string[] {
  return cheques.filter((c) => !c.clearedDate || c.clearedDate > asOfDate).filter((c) => c.issueDate <= asOfDate).map((c) => c.id)
}

// Deposit Maturity Engine -- fixed deposit maturity value via compound interest
export function calculateDepositMaturity(principal: number, annualRatePercent: number, tenureMonths: number, compoundingFrequencyPerYear = 4): { maturityValue: number; interestEarned: number } {
  const n = compoundingFrequencyPerYear
  const t = new Decimal(tenureMonths).div(12).toNumber()
  const maturity = new Decimal(principal).mul(new Decimal(1).plus(new Decimal(annualRatePercent).div(100).div(n)).pow(n * t))
  return { maturityValue: round2(maturity), interestEarned: round2(maturity.minus(principal)) }
}

// Credit Limit Calculator -- generic multiple-of-income based limit, with an existing-obligations deduction
export function calculateCreditLimit(monthlyIncome: number, multiplier: number, existingMonthlyObligations = 0): number {
  const eligible = new Decimal(monthlyIncome).minus(existingMonthlyObligations).mul(multiplier)
  return round2(Decimal.max(0, eligible))
}
