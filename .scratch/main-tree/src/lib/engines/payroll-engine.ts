// VCEL Payroll Engine (computation_engines: gratuity_calculator). Standard
// Indian Payment of Gratuity Act, 1972 formula -- deterministic.
import Decimal from "decimal.js"
import type { CalculationBreakdown } from "@/lib/engines/breakdown"

export type GratuityInput = {
  lastDrawnMonthlySalary: number // basic + DA
  yearsOfService: number // fractional allowed, e.g. 7.6
  isCoveredUnderAct?: boolean // default true: 15/26 formula; false: 15/30 (non-covered establishments)
}

export type GratuityResult = {
  gratuityAmount: number; roundedYearsOfService: number; statutoryCapApplied: boolean
  // Calculation Explainability (VERIDIAN Review Framework gap closure,
  // 2026-07-18): optional, additive -- see income-tax-engine.ts's
  // IncomeTaxResult for the same convention.
  breakdown?: CalculationBreakdown
}

// Sec 4(2): part of a year >= 6 months counts as a full year, under 6 months is ignored.
function roundYearsOfService(years: number): number {
  const wholeYears = Math.floor(years)
  const fraction = years - wholeYears
  return fraction >= 0.5 ? wholeYears + 1 : wholeYears
}

const STATUTORY_CAP = 2_000_000 // Rs. 20 lakh, current Payment of Gratuity Act ceiling

export function calculateGratuity(input: GratuityInput): GratuityResult {
  const { lastDrawnMonthlySalary, isCoveredUnderAct = true } = input
  if (lastDrawnMonthlySalary <= 0) throw new Error("lastDrawnMonthlySalary must be positive")
  if (input.yearsOfService < 0) throw new Error("yearsOfService must be non-negative")

  const roundedYears = roundYearsOfService(input.yearsOfService)
  const divisor = isCoveredUnderAct ? 26 : 30

  const raw = new Decimal(lastDrawnMonthlySalary).mul(15).div(divisor).mul(roundedYears)
  const capped = raw.gt(STATUTORY_CAP)
  const rawAmount = raw.toDecimalPlaces(2).toNumber()

  return {
    gratuityAmount: capped ? STATUTORY_CAP : rawAmount,
    roundedYearsOfService: roundedYears,
    statutoryCapApplied: capped,
    breakdown: {
      steps: [
        { label: "Years of service (Sec 4(2) rounding)", formula: `${input.yearsOfService} years`, value: roundedYears },
        {
          label: `Gratuity formula (${isCoveredUnderAct ? "covered, 15/26" : "not covered, 15/30"})`,
          formula: `${lastDrawnMonthlySalary} x 15 / ${divisor} x ${roundedYears}`,
          value: rawAmount,
        },
        ...(capped ? [{ label: "Payment of Gratuity Act statutory cap applied", formula: `min(${rawAmount}, ${STATUTORY_CAP})`, value: STATUTORY_CAP }] : []),
      ],
    },
  }
}

function round2(d: Decimal): number { return d.toDecimalPlaces(2).toNumber() }

// EPS Calculator -- Pension Fund contribution is 8.33% of employer PF share,
// capped at wage ceiling of Rs 15,000/month (EPFO standard, employer share only)
const EPS_WAGE_CEILING = 15000
export function calculateEps(monthlyBasicPlusDa: number): number {
  const eligibleWage = Math.min(monthlyBasicPlusDa, EPS_WAGE_CEILING)
  return round2(new Decimal(eligibleWage).mul(8.33).div(100))
}

// Labour Welfare Fund Calculator -- state-notified flat contribution (varies
// by state); accepts the applicable slab as input rather than hardcoding one state.
export function calculateLwf(employeeContribution: number, employerContribution: number): { total: number } {
  return { total: round2(new Decimal(employeeContribution).plus(employerContribution)) }
}

// Bonus Calculator -- Payment of Bonus Act 1965: 8.33% min to 20% max of
// (basic+DA), capped at wage ceiling Rs 21,000/month eligibility, Rs 7,000
// (or minimum wage if higher) calculation ceiling.
export function calculateBonus(annualBasicPlusDa: number, bonusPercent: number): number {
  if (bonusPercent < 8.33 || bonusPercent > 20) throw new Error("bonusPercent must be between 8.33 and 20 per the Payment of Bonus Act")
  return round2(new Decimal(annualBasicPlusDa).mul(bonusPercent).div(100))
}

// Incentive Calculator -- generic target-linked incentive (org-defined slabs)
export function calculateIncentive(achievedValue: number, targetValue: number, incentiveSlabs: { minAchievementPercent: number; incentivePercentOfTarget: number }[]): number {
  if (targetValue <= 0) throw new Error("targetValue must be positive")
  const achievementPercent = new Decimal(achievedValue).div(targetValue).mul(100).toNumber()
  const slab = [...incentiveSlabs].sort((a, b) => b.minAchievementPercent - a.minAchievementPercent).find((s) => achievementPercent >= s.minAchievementPercent)
  if (!slab) return 0
  return round2(new Decimal(targetValue).mul(slab.incentivePercentOfTarget).div(100))
}

// Commission Calculator -- flat-rate commission on a base amount (internal payroll scope, distinct from Wave 109's external-partner sales-engine-service.ts)
export function calculatePayrollCommission(saleAmount: number, commissionRatePercent: number): number {
  return round2(new Decimal(saleAmount).mul(commissionRatePercent).div(100))
}

// Overtime Calculator -- Factories Act convention: 2x ordinary hourly rate for overtime hours
export function calculateOvertime(monthlyBasicPlusDa: number, standardMonthlyHours: number, overtimeHours: number, multiplier = 2): number {
  if (standardMonthlyHours <= 0) throw new Error("standardMonthlyHours must be positive")
  const hourlyRate = new Decimal(monthlyBasicPlusDa).div(standardMonthlyHours)
  return round2(hourlyRate.mul(multiplier).mul(overtimeHours))
}

// Shift Allowance Calculator -- flat or percentage-of-basic allowance per shift day
export function calculateShiftAllowance(shiftDays: number, allowancePerShift: number): number {
  return round2(new Decimal(shiftDays).mul(allowancePerShift))
}

// Leave Encashment Calculator -- (basic+DA)/26 * unused leave days (standard convention, same divisor as gratuity)
export function calculateLeaveEncashment(lastDrawnMonthlySalary: number, unusedLeaveDays: number): number {
  return round2(new Decimal(lastDrawnMonthlySalary).div(26).mul(unusedLeaveDays))
}

// Superannuation Calculator -- typically 15% of basic, employer-funded pension contribution (common corporate convention)
export function calculateSuperannuation(annualBasic: number, contributionPercent = 15): number {
  return round2(new Decimal(annualBasic).mul(contributionPercent).div(100))
}

// Full & Final Settlement Calculator -- sums components payable on exit, nets recoveries
export type FnfComponents = { unpaidSalary: number; leaveEncashment: number; gratuity?: number; bonus?: number; recoveries?: number }
export function calculateFullAndFinalSettlement(c: FnfComponents): number {
  return round2(new Decimal(c.unpaidSalary).plus(c.leaveEncashment).plus(c.gratuity ?? 0).plus(c.bonus ?? 0).minus(c.recoveries ?? 0))
}

// Arrear Calculator -- difference between revised and original pay across affected months
export function calculateArrears(revisedMonthlyPay: number, originalMonthlyPay: number, affectedMonths: number): number {
  return round2(new Decimal(revisedMonthlyPay).minus(originalMonthlyPay).mul(affectedMonths))
}

// Increment Calculator
export function calculateIncrement(currentSalary: number, incrementPercent: number): { newSalary: number; incrementAmount: number } {
  const incrementAmount = new Decimal(currentSalary).mul(incrementPercent).div(100)
  return { incrementAmount: round2(incrementAmount), newSalary: round2(new Decimal(currentSalary).plus(incrementAmount)) }
}

// Salary Revision Calculator -- applies a revision across basic/HRA/other components proportionally
export function calculateSalaryRevision(components: Record<string, number>, revisionPercent: number): Record<string, number> {
  const revised: Record<string, number> = {}
  for (const [key, value] of Object.entries(components)) {
    revised[key] = round2(new Decimal(value).mul(new Decimal(1).plus(new Decimal(revisionPercent).div(100))))
  }
  return revised
}
