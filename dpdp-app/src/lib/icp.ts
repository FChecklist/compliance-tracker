// The weekly ICP routine: IDENTIFY what you hold, CLASSIFY it, PROVE it, every week. Pure functions and types only (no React, no network).
//
// The server (drizzle/0761 and later) is the source of truth: dpdp_icp_status returns the checklist, dpdp_icp_register the lines. This file holds
//   * the wire types and the plain-word labels the screens and the Monday e-mail share,
//   * itemFlags(): the SAME derived rules as dpdp.icp_item_flags() in SQL (a parity test runs both on the same lines), used by the offline mock and the e-mail text,
//   * small helpers (the Monday of a week, the "this is a person, not a thing" name guard).
// Wording rule for everything shown: a flag is a prompt to look, never a finding; the score counts this week's routine steps, it is not a legal rating.

export type IcpKind = "data_set" | "system" | "vendor" | "person_group"
export type IcpStage = "identify" | "classify" | "prove"
export type PrincipalType = "student" | "parent_guardian" | "staff" | "applicant" | "alumni" | "client_staff" | "customer" | "visitor" | "other"
export type LawfulBasis = "consent" | "legitimate_use" | "legal_obligation" | "state_function" | "employment" | "child_exemption" | "not_sure"
export type Sensitivity = "ordinary" | "elevated" | "high"
export type AgreementStatus = "none" | "requested" | "signed"

export type IcpFlagWire = { key: string; text: string }
export type IcpItem = {
  id: string; kind: IcpKind; name: string; whereHeld: string | null; holderLabel: string | null; status: "active" | "retired"; source: "manual" | "starter"
  firstSeenWeek: string; lastConfirmedWeek: string | null
  principalType: PrincipalType | null; children: boolean | null; purpose: string | null; lawfulBasis: LawfulBasis | null; sensitivity: Sensitivity | null
  retentionDays: number | null; retentionNote: string | null; recipients: string | null
  agreementStatus: AgreementStatus | null; agreementRef: string | null; agreementOn: string | null
  flags: IcpFlagWire[]
}
/** What a person may send to dpdp_icp_save_item. Keys not present are left as they are; null clears a value. */
export type IcpItemInput = Partial<Pick<IcpItem, "kind" | "name" | "whereHeld" | "holderLabel" | "principalType" | "children" | "purpose" | "lawfulBasis" | "sensitivity" | "retentionDays" | "retentionNote" | "recipients" | "agreementStatus" | "agreementRef" | "agreementOn">> & { id?: string }

export type IcpStep = { key: string; label: string; done: boolean; count: number | null; action: string | null }
export type IcpSection = { done: number; total: number; steps: IcpStep[] }
export type IcpRunWire = { stage: IcpStage; weekStart: string; ranAt: string; byKind: "person" | "software"; actor: string | null; outcome: "ok" | "partial" | "failed" | "skipped"; note: string | null; percent: number | null }
export type IcpStatus = {
  weekStart: string; identify: IcpSection; classify: IcpSection; prove: IcpSection
  done: number; total: number; percent: number; status: "not_started" | "in_progress" | "complete"; notALegalRating: true; runs: IcpRunWire[]
}

export const STAGE_INFO: Record<IcpStage, { name: string; promise: string }> = {
  identify: { name: "Identify", promise: "Know what personal data you hold, where it lives and who holds it. Add what is new; check the rest is still true." },
  classify: { name: "Classify", promise: "For each line: whose data, children or not, why you hold it, on what basis, for how long. The rules below then show what needs a look." },
  prove: { name: "Prove", promise: "Keep the records that show it: files you hold (as fingerprints), breaches, requests, agreements and erasures, and a signed-off week." },
}
export const STAGES: IcpStage[] = ["identify", "classify", "prove"]

export const KIND_LABEL: Record<IcpKind, string> = { data_set: "A data set", system: "A system or place", vendor: "An outside helper", person_group: "A group of people" }
export const KIND_LABEL_PLURAL: Record<IcpKind, string> = { data_set: "Data sets", system: "Systems and places", vendor: "Outside helpers", person_group: "Groups of people" }
export const PRINCIPAL_LABEL: Record<PrincipalType, string> = {
  student: "Students", parent_guardian: "Parents and guardians", staff: "Staff", applicant: "Applicants", alumni: "Alumni", client_staff: "Our clients' people", customer: "Customers", visitor: "Visitors", other: "Others",
}
export const BASIS_LABEL: Record<LawfulBasis, string> = {
  consent: "Their consent (a parent's, for a child)", legitimate_use: "A legitimate use (s.7)", legal_obligation: "A legal duty to disclose", state_function: "A State function or benefit", employment: "Employment",
  child_exemption: "A school exemption: tracking or monitoring for education or safety only", not_sure: "Not sure yet",
}
export const SENSITIVITY_LABEL: Record<Sensitivity, string> = { ordinary: "Ordinary", elevated: "Needs more care", high: "Needs the most care" }
export const AGREEMENT_LABEL: Record<AgreementStatus, string> = { none: "No agreement yet", requested: "Asked for", signed: "Signed" }

export const FLAG_TEXT: Record<string, string> = {
  unclassified: "Not classified yet: say whose data it is, why you hold it, on what basis and for how long.",
  children_basis_missing: "Children's data with no basis recorded. The Act needs a parent's verifiable consent, unless a specific exemption applies. Record which.",
  children_basis_check: "Children's data on a basis other than a parent's consent. The Act allows only narrow exemptions (the Fourth Schedule; for a school, only tracking or monitoring for education or safety). Say which one applies, or collect parental consent.",
  children_consent_not_collected: "Children's data held on consent, but not every parent link has been answered yet.",
  vendor_agreement_missing: "An outside helper without a signed agreement on record.",
  stale: "Not re-checked for more than three weeks.",
}

/** The Monday (UTC) that starts the week containing d, as YYYY-MM-DD. Weeks run Monday to Sunday. */
export function mondayOf(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7))
  return x.toISOString().slice(0, 10)
}
export const addDaysISO = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

/** The same guard the database has: the register holds names of THINGS. An e-mail address or a long number is a person's data and is refused. */
export function looksLikePerson(name: string): boolean {
  return /@/.test(name) || /[0-9][0-9 -]{8,}[0-9]/.test(name)
}

/** dpdp.icp_item_flags(), line for line. */
export function itemFlags(i: Pick<IcpItem, "kind" | "status" | "principalType" | "children" | "purpose" | "lawfulBasis" | "retentionDays" | "retentionNote" | "agreementStatus" | "firstSeenWeek" | "lastConfirmedWeek">, weekStart: string, childConsentAnswered: boolean): string[] {
  const v: string[] = []
  if (i.status !== "active") return v
  const personal = i.kind === "data_set" || i.kind === "person_group"
  if (personal && (i.principalType === null || i.children === null || i.purpose === null || i.lawfulBasis === null || (i.retentionDays === null && i.retentionNote === null))) v.push("unclassified")
  if (personal && i.children === true) {
    if (i.lawfulBasis === null || i.lawfulBasis === "not_sure") v.push("children_basis_missing")
    else if (i.lawfulBasis === "consent") { if (!childConsentAnswered) v.push("children_consent_not_collected") }
    else if (i.lawfulBasis !== "child_exemption") v.push("children_basis_check") // s.7 or employment alone do not stand in for a parent's consent
  }
  if (i.kind === "vendor" && (i.agreementStatus ?? "none") !== "signed") v.push("vendor_agreement_missing")
  if ((i.lastConfirmedWeek ?? i.firstSeenWeek) < addDaysISO(weekStart, -21)) v.push("stale")
  return v
}

export const isClassified = (i: Pick<IcpItem, "principalType" | "children" | "purpose" | "lawfulBasis" | "retentionDays" | "retentionNote">) =>
  i.principalType !== null && i.children !== null && i.purpose !== null && i.lawfulBasis !== null && (i.retentionDays !== null || i.retentionNote !== null)

/** "Week of Monday 9 Nov" style line. UTC so it reads the same everywhere. */
export function weekLine(weekStart: string): string {
  return new Date(`${weekStart}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" }).replace(",", "")
}

export const STATUS_WORD: Record<IcpStatus["status"], string> = { not_started: "Not started this week", in_progress: "In progress", complete: "All of this week's steps are done" }

/** Retention as a person reads it. */
export function retentionLine(i: Pick<IcpItem, "retentionDays" | "retentionNote">): string {
  if (i.retentionDays) {
    const y = i.retentionDays / 365
    return Number.isInteger(y) ? `${y} year${y === 1 ? "" : "s"}` : `${i.retentionDays} days`
  }
  return i.retentionNote ?? "Not set"
}
