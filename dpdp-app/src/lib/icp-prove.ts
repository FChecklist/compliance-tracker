// PROVE, the third stage of the weekly routine (drizzle/0762): evidence, breach log, requests and grievances, erasure, and the evidence pack.
// Pure types, labels and helpers (no React, no network). The database is the source of truth; nothing here decides what is overdue.
// Wording rule: the organisation RECORDS things here. We never say a record is verified, compliant, certified or guaranteed.

export type EvidenceKind = "policy" | "notice" | "consent" | "agreement" | "training" | "assessment" | "breach_report" | "request_log" | "other"
export type RequestType = "access" | "correction" | "erasure" | "nominee" | "grievance"
export type ArrivedVia = "in_person" | "email" | "post" | "phone" | "portal" | "other"
export type RequestOutcome = "provided" | "corrected" | "erased" | "refused_with_reason" | "withdrawn" | "answered"
export type ErasureTrigger = "retention_ended" | "person_request" | "consent_withdrawn" | "purpose_served" | "other"

export type EvidenceWire = {
  id: string; kind: EvidenceKind; title: string; reference: string | null; filename: string | null; sha256: string | null; sizeBytes: number | null
  evidenceOn: string; itemId: string | null; itemName: string | null; obligationId: string | null; recordedAt: string; withdrawn: boolean; withdrawnReason: string | null
}
export type BreachWire = {
  id: string; state: string; becameAwareAt: string; boardDetailDueAt: string; certInDueAt: string | null; peopleAffected: number | null; description: string | null
  boardNotifiedAt: string | null; boardDetailedAt: string | null; individualsNotifiedAt: string | null; certInReportedAt: string | null; certInReference: string | null; pastClock: boolean
}
export type RequestWire = {
  ref: string; type: RequestType; arrivedVia?: ArrivedVia; summary?: string; receivedOn: string; dueOn: string; state: "open" | "answered"; outcome: string | null; pastDue: boolean
}
export type ErasureWire = { id: string; scope: string; trigger: ErasureTrigger; dueOn: string; state: "open" | "done" | "not_needed"; doneOn: string | null; method: string | null; pastDue: boolean; itemId: string | null }
export type VendorWire = { id: string; name: string; agreementStatus: "none" | "requested" | "signed"; agreementRef: string | null; agreementOn: string | null; hasEvidence: boolean }
export type ProveCounts = {
  jobsLate: number; events: number; evidenceThisWeek: number; nothingToAttach: boolean; signed: boolean; agreementsWithoutEvidence: number
  breachesPastClock: number; breachesOpen: number; requestsPastDue: number; requestsOpen: number; erasuresPastDue: number; erasuresOpen: number
}
export type ProveOverview = { weekStart: string; counts: ProveCounts; evidence: EvidenceWire[]; breaches: BreachWire[]; requests: RequestWire[]; erasures: ErasureWire[]; vendors: VendorWire[] }

export type EvidenceInput = { kind: EvidenceKind; title: string; reference?: string; filename?: string; sha256?: string; sizeBytes?: number; evidenceOn?: string; itemId?: string; obligationId?: string }
export type BreachInput = { description: string; becameAwareAt?: string; peopleAffected?: number; nature?: string; extent?: string; location?: string; likelyImpact?: string }
export type BreachUpdate = { boardNotified?: boolean; boardDetailed?: boolean; individualsNotified?: boolean; certInReported?: boolean; certInReference?: string; mitigation?: string; cause?: string; remedialSteps?: string; peopleAffected?: number; closed?: boolean }
export type RequestInput = { type: RequestType; arrivedVia?: ArrivedVia; receivedOn?: string; summary?: string }
export type ErasureInput = { scope: string; trigger?: ErasureTrigger; dueOn?: string; itemId?: string }

export const EVIDENCE_LABEL: Record<EvidenceKind, string> = {
  policy: "A policy or procedure", notice: "A privacy notice", consent: "A consent record", agreement: "A signed agreement with an outside helper", training: "Training given",
  assessment: "A check or review you did", breach_report: "A breach report", request_log: "A request log", other: "Something else",
}
export const REQUEST_LABEL: Record<RequestType, string> = {
  access: "Wants to see their data", correction: "Wants a correction", erasure: "Wants it erased", nominee: "Names someone to act for them", grievance: "A complaint (grievance)",
}
export const VIA_LABEL: Record<ArrivedVia, string> = { in_person: "In person", email: "By e-mail", post: "By post", phone: "By phone", portal: "Through a form", other: "Another way" }
export const OUTCOME_LABEL: Record<RequestOutcome, string> = {
  provided: "Data provided", corrected: "Corrected", erased: "Erased", refused_with_reason: "Refused, with the reason given", withdrawn: "Person withdrew it", answered: "Answered",
}
export const TRIGGER_LABEL: Record<ErasureTrigger, string> = {
  retention_ended: "The keeping period ended", person_request: "A person asked", consent_withdrawn: "Consent was withdrawn", purpose_served: "The purpose is over", other: "Another reason",
}
export const PROVE_PROMISE = "Keep the records that show it: files you hold (as fingerprints), breaches, requests, agreements and erasures, and a signed-off week."

/** The honest line shown next to every evidence form. */
export const EVIDENCE_NOTE = "VERIDIAN does not keep your document. Your browser works out its fingerprint (a short code) and sends only that, the name you give it and where you keep the original. It shows the file has not changed since you recorded it. It does not show the file is right."

/** SHA-256 of a file's bytes as 64 lowercase hex characters. Runs in the browser; the file never leaves the device. */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("")
}

export function shortHash(h: string | null): string {
  return h ? `${h.slice(0, 10)}…${h.slice(-6)}` : "none"
}

/** "3 Nov 2026" from an ISO date or timestamp (UTC, so it reads the same everywhere). */
export function niceDate(iso: string | null | undefined): string {
  if (!iso) return "not recorded"
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso)
  return Number.isNaN(d.getTime()) ? "not recorded" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
}

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

export type EvidencePack = {
  what: string; organisation: string | null; generatedAt: string; weekStart: string
  status: { done: number; total: number; percent: number }
  register: { kind: string; name: string; whereHeld: string | null; principalType: string | null; children: boolean | null; lawfulBasis: string | null; retentionDays: number | null; retentionNote: string | null; flags: { text: string }[] }[]
  retiredLines: number; evidence: EvidenceWire[]
  notices: { docKind: string; version: string; releasedOn: string | null; state: string }[]
  consent: { campaigns: number; linksIssued: number; linksAnswered: number; answersGiven: number; answersRefusedOrWithdrawn: number }
  breaches: Omit<BreachWire, "description">[]; requests: Omit<RequestWire, "summary">[]; vendors: VendorWire[]; erasures: ErasureWire[]
  jobs: { job: string; state: string; dueOn: string | null; closedAt: string | null }[]
  weeklyRecord: { stage: string; weekStart: string; ranAt: string; byKind: string; outcome: string; percent: number | null }[]
  history: { events: number; checked: number; linksBroken: number; hashesWrong: number; intact: boolean; headHash: string | null; firstAt: string | null; lastAt: string | null }
  limits: string[]
}

/** A printable page for the pack (open it, then print or save as PDF). Every value is escaped; there is no script in it. */
export function packToHtml(p: EvidencePack): string {
  const table = (head: string[], rows: (string | number | null | undefined)[][]) =>
    rows.length === 0 ? "<p><i>None recorded.</i></p>"
      : `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table>`
  const h = p.history
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Evidence pack${p.organisation ? ` - ${esc(p.organisation)}` : ""}</title>
<style>body{font:14px/1.5 system-ui,sans-serif;max-width:900px;margin:24px auto;padding:0 16px;color:#1b1b2f}h1{font-size:24px}h2{font-size:17px;margin-top:26px;border-bottom:1px solid #ccc}table{border-collapse:collapse;width:100%;font-size:12.5px}th,td{border:1px solid #ccc;padding:4px 6px;text-align:left;vertical-align:top;word-break:break-word}th{background:#f2f2f7}.note{background:#fff8e6;border:1px solid #e8d49a;padding:8px 12px}@media print{h2{break-after:avoid}}</style></head><body>
<h1>Evidence pack${p.organisation ? `: ${esc(p.organisation)}` : ""}</h1>
<p class="note">${esc(p.what)}</p>
<p>Made on ${esc(niceDate(p.generatedAt))}. Week of ${esc(niceDate(p.weekStart))}: ${p.status.done} of ${p.status.total} routine steps done (${p.status.percent}%). This counts routine steps. It is not a rating of legal position.</p>
<h2>1. What you hold (register)</h2>
${table(["Kind", "Name", "Kept in", "Whose", "Children", "Basis", "Keep for", "Things to look at"], p.register.map((r) => [r.kind, r.name, r.whereHeld, r.principalType, r.children === null ? "not set" : r.children ? "yes" : "no", r.lawfulBasis, r.retentionDays ? `${r.retentionDays} days` : r.retentionNote, r.flags.map((f) => f.text).join(" ")]))}
<p>Lines taken off the register: ${p.retiredLines}.</p>
<h2>2. Evidence recorded by the organisation</h2>
${table(["Date", "Kind", "Title", "Fingerprint (SHA-256)", "File name", "Kept at", "Status"], p.evidence.map((e) => [niceDate(e.evidenceOn), e.kind, e.title, e.sha256, e.filename, e.reference, e.withdrawn ? `Withdrawn: ${e.withdrawnReason ?? ""}` : "Current"]))}
<h2>3. Notices</h2>
${table(["Document", "Version", "Released", "State"], p.notices.map((n) => [n.docKind, n.version, niceDate(n.releasedOn), n.state]))}
<h2>4. Consent (counts only)</h2>
<p>Campaigns ${p.consent.campaigns}. Links issued ${p.consent.linksIssued}. Links answered ${p.consent.linksAnswered}. Answers given ${p.consent.answersGiven}. Refused or withdrawn ${p.consent.answersRefusedOrWithdrawn}.</p>
<h2>5. Breaches</h2>
${table(["Became aware", "Board detail due", "People affected", "Board told", "Board detailed", "People told", "CERT-In", "State"], p.breaches.map((b) => [niceDate(b.becameAwareAt), niceDate(b.boardDetailDueAt), b.peopleAffected, niceDate(b.boardNotifiedAt), niceDate(b.boardDetailedAt), niceDate(b.individualsNotifiedAt), niceDate(b.certInReportedAt), b.state]))}
<h2>6. Requests and grievances (no names)</h2>
${table(["Ref", "Type", "Received", "Due", "State", "Outcome"], p.requests.map((r) => [r.ref, r.type, niceDate(r.receivedOn), niceDate(r.dueOn), r.state, r.outcome]))}
<h2>7. Outside helpers</h2>
${table(["Helper", "Agreement", "Reference", "Date", "Record attached"], p.vendors.map((v) => [v.name, v.agreementStatus, v.agreementRef, niceDate(v.agreementOn), v.hasEvidence ? "yes" : "no"]))}
<h2>8. Erasure</h2>
${table(["What", "Why", "Due", "State", "Done on", "How"], p.erasures.map((e) => [e.scope, e.trigger, niceDate(e.dueOn), e.state, niceDate(e.doneOn), e.method]))}
<h2>9. Jobs</h2>
${table(["Job", "State", "Due", "Closed"], p.jobs.map((j) => [j.job, j.state, niceDate(j.dueOn), niceDate(j.closedAt)]))}
<h2>10. Weekly record</h2>
${table(["Week", "Stage", "By", "Outcome", "Steps done %"], p.weeklyRecord.map((w) => [niceDate(w.weekStart), w.stage, w.byKind, w.outcome, w.percent]))}
<h2>11. The History record</h2>
<p>${h.events} entries from ${esc(niceDate(h.firstAt))} to ${esc(niceDate(h.lastAt))}. Checked ${h.checked}: links broken ${h.linksBroken}, entries that do not match their fingerprint ${h.hashesWrong}. ${h.intact ? "Every checked entry matches the one before it." : "Something does not match: ask us before relying on this part."} Latest fingerprint: ${esc(h.headHash ?? "none")}.</p>
<h2>What this does not show</h2>
<ul>${p.limits.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
</body></html>`
}
