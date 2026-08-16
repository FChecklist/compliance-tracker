// VCEL HR Engine. leave_balance_engine/performance_score_calculator already
// have partial schema coverage (leaveRequests/performanceReviews).
import Decimal from "decimal.js"

// 1. Attendance Calculator -- attendance % from present/total working days
export function calculateAttendancePercent(presentDays: number, totalWorkingDays: number): number {
  if (totalWorkingDays <= 0) throw new Error("totalWorkingDays must be positive")
  return round2(new Decimal(presentDays).div(totalWorkingDays).mul(100))
}

// 2. Leave Balance Engine -- opening balance + accrued - taken (standard leave-ledger formula)
export function calculateLeaveBalance(openingBalance: number, accrued: number, taken: number): number {
  return round2(new Decimal(openingBalance).plus(accrued).minus(taken))
}

// 3. Shift Planner -- assigns employees to shifts round-robin, respecting per-shift capacity
export function planShifts(employeeIds: string[], shifts: { name: string; capacity: number }[]): Record<string, string[]> {
  const plan: Record<string, string[]> = {}
  for (const s of shifts) plan[s.name] = []
  let shiftIdx = 0
  for (const empId of employeeIds) {
    let attempts = 0
    while (plan[shifts[shiftIdx].name].length >= shifts[shiftIdx].capacity && attempts < shifts.length) {
      shiftIdx = (shiftIdx + 1) % shifts.length
      attempts++
    }
    plan[shifts[shiftIdx].name].push(empId)
    shiftIdx = (shiftIdx + 1) % shifts.length
  }
  return plan
}

// 4. Roster Engine -- builds a date x employee roster given a rotation pattern (array of shift names cycled per day)
export function buildRoster(employeeIds: string[], dates: string[], rotationPattern: string[]): Record<string, Record<string, string>> {
  const roster: Record<string, Record<string, string>> = {}
  employeeIds.forEach((empId, empIdx) => {
    roster[empId] = {}
    dates.forEach((date, dateIdx) => {
      roster[empId][date] = rotationPattern[(empIdx + dateIdx) % rotationPattern.length]
    })
  })
  return roster
}

// 5. Experience Calculator -- total experience in years (fractional) between two dates
export function calculateExperienceYears(fromDate: string, toDate: string): number {
  const days = (new Date(toDate).getTime() - new Date(fromDate).getTime()) / 86400000
  return round2(new Decimal(days).div(365.25))
}

// 6. Notice Period Calculator -- remaining notice days from resignation date + notice period days
export function calculateNoticePeriodEnd(resignationDate: string, noticePeriodDays: number): string {
  const d = new Date(resignationDate)
  d.setDate(d.getDate() + noticePeriodDays)
  return d.toISOString().slice(0, 10)
}

// 7. Probation Calculator -- probation end date + eligibility for confirmation
export function calculateProbationEnd(joiningDate: string, probationMonths: number): string {
  const d = new Date(joiningDate)
  d.setMonth(d.getMonth() + probationMonths)
  return d.toISOString().slice(0, 10)
}

// 8. Performance Score Calculator -- weighted average across rated competencies
export function calculatePerformanceScore(ratings: { competency: string; score: number; weight: number }[]): number {
  const totalWeight = ratings.reduce((s, r) => s + r.weight, 0)
  if (totalWeight <= 0) throw new Error("total weight must be positive")
  return round2(ratings.reduce((s, r) => s.plus(new Decimal(r.score).mul(r.weight)), new Decimal(0)).div(totalWeight))
}

// 9. Attrition Calculator -- standard HR formula: (separations / average headcount) * 100
export function calculateAttritionRate(separations: number, openingHeadcount: number, closingHeadcount: number): number {
  const avgHeadcount = new Decimal(openingHeadcount).plus(closingHeadcount).div(2)
  if (avgHeadcount.lte(0)) throw new Error("average headcount must be positive")
  return round2(new Decimal(separations).div(avgHeadcount).mul(100))
}

function round2(d: Decimal): number { return d.toDecimalPlaces(2).toNumber() }
