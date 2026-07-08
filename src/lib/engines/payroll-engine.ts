// VCEL Payroll Engine (computation_engines: gratuity_calculator). Standard
// Indian Payment of Gratuity Act, 1972 formula -- deterministic.
import Decimal from "decimal.js"

export type GratuityInput = {
  lastDrawnMonthlySalary: number // basic + DA
  yearsOfService: number // fractional allowed, e.g. 7.6
  isCoveredUnderAct?: boolean // default true: 15/26 formula; false: 15/30 (non-covered establishments)
}

export type GratuityResult = { gratuityAmount: number; roundedYearsOfService: number; statutoryCapApplied: boolean }

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

  return {
    gratuityAmount: capped ? STATUTORY_CAP : raw.toDecimalPlaces(2).toNumber(),
    roundedYearsOfService: roundedYears,
    statutoryCapApplied: capped,
  }
}
