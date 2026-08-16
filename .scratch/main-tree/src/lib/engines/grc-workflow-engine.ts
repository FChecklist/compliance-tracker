// VCEL GRC Workflow Engine (deterministic, no LLM). Incidents/Whistleblower/
// POSH/Vendor Risk were logbook-level trackers (a status field, no computed
// SLA or scoring) -- this adds real, formula-based automation on top of
// their existing data, matching this codebase's "engines compute, AI never
// invents a number" discipline. Pure functions, no DB access.
import Decimal from "decimal.js"

const DAY_MS = 24 * 60 * 60 * 1000

export type SlaStatus = { dueDate: string | null; daysRemaining: number | null; isOverdue: boolean; urgency: "none" | "ok" | "due_soon" | "overdue" }

/** Generic due-date SLA computation, reused across incident CAPA / whistleblower investigation / any dated obligation. */
export function computeSlaStatus(dueDate: Date | string | null, referenceDate: Date = new Date()): SlaStatus {
  if (!dueDate) return { dueDate: null, daysRemaining: null, isOverdue: false, urgency: "none" }
  const due = typeof dueDate === "string" ? new Date(dueDate) : dueDate
  const daysRemaining = Math.ceil((due.getTime() - referenceDate.getTime()) / DAY_MS)
  const isOverdue = daysRemaining < 0
  const urgency = isOverdue ? "overdue" : daysRemaining <= 3 ? "due_soon" : "ok"
  return { dueDate: due.toISOString().slice(0, 10), daysRemaining, isOverdue, urgency }
}

// POSH Act 2013, Sec 11(4): the Internal Committee must complete its
// inquiry within 90 days of the complaint being received (the 90-day
// figure is the statute itself, not an org preference -- unlike
// whistleblower-workflow-service.ts's SLA, this is never module-rule-
// configurable).
const POSH_INQUIRY_DAYS = 90

export function computePoshInquiryDeadline(receivedDate: Date | string, referenceDate: Date = new Date()): SlaStatus {
  const received = typeof receivedDate === "string" ? new Date(receivedDate) : receivedDate
  const deadline = new Date(received.getTime() + POSH_INQUIRY_DAYS * DAY_MS)
  return computeSlaStatus(deadline, referenceDate)
}

export type IccMember = { role: string | null }
export type IccCompositionResult = { isValid: boolean; issues: string[]; presidingOfficerCount: number; memberCount: number; externalMemberCount: number; totalCount: number }

// POSH Act 2013, Sec 4(2): the Internal Committee must have at least 4
// members -- one Presiding Officer, at least 2 Members from amongst
// employees, and one External Member from an NGO/association familiar with
// sexual harassment issues. Gender (Presiding Officer + majority members
// must be women) isn't verifiable from this schema's data (no gender
// field on posh_committee), so this checks the composition counts the
// data model CAN verify, not a false claim of full statutory compliance.
export function validateIccComposition(members: IccMember[]): IccCompositionResult {
  const presidingOfficerCount = members.filter((m) => m.role === "Presiding Officer").length
  const memberCount = members.filter((m) => m.role === "Member").length
  const externalMemberCount = members.filter((m) => m.role === "External Member").length
  const totalCount = members.length

  const issues: string[] = []
  if (presidingOfficerCount === 0) issues.push("No Presiding Officer designated.")
  if (presidingOfficerCount > 1) issues.push("More than one Presiding Officer designated -- exactly one is required.")
  if (memberCount < 2) issues.push(`Only ${memberCount} internal Member(s) -- at least 2 are required.`)
  if (externalMemberCount === 0) issues.push("No External Member designated -- at least 1 is required (NGO/association familiar with sexual harassment issues).")
  if (totalCount < 4) issues.push(`Committee has ${totalCount} member(s) -- the statutory minimum is 4.`)

  return { isValid: issues.length === 0, issues, presidingOfficerCount, memberCount, externalMemberCount, totalCount }
}

export type VendorRiskInput = {
  certificationCount: number
  hasValidGstin: boolean | null // null = not applicable/unknown
  hasValidPan: boolean | null
  incidentCount: number // count of past incidents/complaints linked to this vendor
  contractValueInr: number
  monthsSinceLastAssessment: number | null
}
export type VendorRiskResult = { score: number; tier: "low" | "medium" | "high" | "critical"; factors: { label: string; points: number }[] }

/**
 * Deterministic 0-100 risk score (higher = riskier), replacing a manually-
 * picked riskTier free-text field with a real weighted formula. Weights are
 * a documented starting point (certifications reduce risk, unverified
 * GSTIN/PAN and past incidents increase it, higher contract value raises
 * the stakes of getting it wrong, staleness of assessment increases
 * uncertainty) -- an org can still override the resulting tier manually if
 * they disagree, this just gives them a real number to start from instead
 * of a blank pick-list.
 */
export function computeVendorRiskScore(input: VendorRiskInput): VendorRiskResult {
  const factors: { label: string; points: number }[] = []
  let score = new Decimal(30) // baseline

  const certPoints = -Math.min(input.certificationCount * 5, 20)
  score = score.plus(certPoints)
  factors.push({ label: `${input.certificationCount} certification(s) on file`, points: certPoints })

  if (input.hasValidGstin === false) { score = score.plus(15); factors.push({ label: "GSTIN missing or fails checksum", points: 15 }) }
  if (input.hasValidPan === false) { score = score.plus(15); factors.push({ label: "PAN missing or invalid format", points: 15 }) }

  const incidentPoints = Math.min(input.incidentCount * 10, 30)
  if (incidentPoints > 0) { score = score.plus(incidentPoints); factors.push({ label: `${input.incidentCount} past incident(s)/complaint(s)`, points: incidentPoints }) }

  const contractPoints = input.contractValueInr >= 10_00_00_000 ? 15 : input.contractValueInr >= 1_00_00_000 ? 8 : 0
  if (contractPoints > 0) { score = score.plus(contractPoints); factors.push({ label: "High contract value", points: contractPoints }) }

  if (input.monthsSinceLastAssessment == null) {
    score = score.plus(10); factors.push({ label: "Never assessed", points: 10 })
  } else if (input.monthsSinceLastAssessment > 12) {
    score = score.plus(10); factors.push({ label: `Last assessed ${input.monthsSinceLastAssessment} months ago (>12)`, points: 10 })
  }

  const clamped = Decimal.max(0, Decimal.min(100, score)).toNumber()
  const tier = clamped >= 70 ? "critical" : clamped >= 45 ? "high" : clamped >= 20 ? "medium" : "low"
  return { score: Math.round(clamped), tier, factors }
}
