// PROVE for the OFFLINE MOCK client: the same rules drizzle/0762 runs, over in-memory state, so the screens and the browser tests behave like the live ones.
// Nothing here is used against a real database. Called from icp-mock.ts (icpRpc) for the Prove functions.
import { looksLikePerson, mondayOf, type IcpStage } from "./icp"
import type { IcpMockHost, IcpMockState } from "./icp-mock"
import type {
  ArrivedVia, BreachInput, BreachUpdate, BreachWire, ErasureInput, ErasureWire, EvidenceInput, EvidencePack, EvidenceWire, ProveCounts, ProveOverview, RequestInput, RequestOutcome, RequestWire, VendorWire,
} from "./icp-prove"

export type ProveMockState = { evidence: EvidenceWire[]; breaches: BreachWire[]; requests: RequestWire[]; erasures: ErasureWire[] }
type Result = { data: unknown; error: null } | { data: null; error: { message: string; code?: string } }
const ok = (data: unknown): Result => ({ data, error: null })
const fail = (message: string, code?: string): Result => ({ data: null, error: { message, code } })
let seq = 0
const DAY = 86_400_000
const EVIDENCE_KINDS = ["policy", "notice", "consent", "agreement", "training", "assessment", "breach_report", "request_log", "other"]
const REQUEST_TYPES = ["access", "correction", "erasure", "nominee", "grievance"]
const OUTCOMES = ["provided", "corrected", "erased", "refused_with_reason", "withdrawn", "answered"]
const TRIGGERS = ["retention_ended", "person_request", "consent_withdrawn", "purpose_served", "other"]
const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z")
const day = (d: Date) => d.toISOString().slice(0, 10)

const icpOf = (host: IcpMockHost): IcpMockState => (host.icp ??= { items: [], runs: [], childConsentAnswered: false })
export const proveState = (host: IcpMockHost): ProveMockState => (icpOf(host).prove ??= { evidence: [], breaches: [], requests: [], erasures: [] })

export function proveCounts(host: IcpMockHost, now = new Date()): ProveCounts {
  const st = icpOf(host)
  const ps = proveState(host)
  const week = mondayOf(now)
  const today = day(now)
  const stage: IcpStage = "prove"
  return {
    jobsLate: host.rows.filter((r) => !r.na && !r.yes && r.due.slice(0, 10) < today).length,
    events: host.eventsThisWeek,
    evidenceThisWeek: ps.evidence.filter((e) => !e.withdrawn && mondayOf(new Date(e.recordedAt)) === week).length,
    nothingToAttach: st.runs.some((r) => r.weekStart === week && r.stage === stage && r.byKind === "person" && r.outcome === "skipped"),
    signed: st.runs.some((r) => r.weekStart === week && r.stage === stage && r.byKind === "person" && r.outcome === "ok"),
    agreementsWithoutEvidence: st.items.filter((i) => i.status === "active" && i.kind === "vendor" && i.agreementStatus === "signed" && !ps.evidence.some((e) => !e.withdrawn && e.kind === "agreement" && e.itemId === i.id)).length,
    breachesPastClock: ps.breaches.filter((b) => b.state !== "closed" && new Date(b.boardDetailDueAt) < now && !b.boardDetailedAt).length,
    breachesOpen: ps.breaches.filter((b) => b.state === "open").length,
    requestsPastDue: ps.requests.filter((r) => r.state === "open" && r.dueOn < today).length,
    requestsOpen: ps.requests.filter((r) => r.state === "open").length,
    erasuresPastDue: ps.erasures.filter((e) => e.state === "open" && e.dueOn < today).length,
    erasuresOpen: ps.erasures.filter((e) => e.state === "open").length,
  }
}

function vendors(host: IcpMockHost): VendorWire[] {
  const ps = proveState(host)
  return icpOf(host).items.filter((i) => i.status === "active" && i.kind === "vendor").sort((a, b) => a.name.localeCompare(b.name)).map((i) => ({
    id: i.id, name: i.name, agreementStatus: i.agreementStatus ?? "none", agreementRef: i.agreementRef, agreementOn: i.agreementOn,
    hasEvidence: ps.evidence.some((e) => !e.withdrawn && e.kind === "agreement" && e.itemId === i.id),
  }))
}

export function proveOverview(host: IcpMockHost, now = new Date()): ProveOverview {
  const ps = proveState(host)
  const today = day(now)
  return {
    weekStart: mondayOf(now), counts: proveCounts(host, now),
    evidence: ps.evidence.slice().sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)),
    breaches: ps.breaches.map((b) => ({ ...b, pastClock: b.state !== "closed" && new Date(b.boardDetailDueAt) < now && !b.boardDetailedAt })).sort((a, b) => b.becameAwareAt.localeCompare(a.becameAwareAt)),
    requests: ps.requests.map((r) => ({ ...r, pastDue: r.state === "open" && r.dueOn < today })).sort((a, b) => (b.receivedOn ?? "").localeCompare(a.receivedOn ?? "")),
    erasures: ps.erasures.map((e) => ({ ...e, pastDue: e.state === "open" && e.dueOn < today })).sort((a, b) => a.dueOn.localeCompare(b.dueOn)),
    vendors: vendors(host),
  }
}

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null)
const contactMsg = "This looks like a person's e-mail address or phone number. Describe the record without it"

export function proveRpc(host: IcpMockHost, fn: string, args: Record<string, unknown> | undefined, canWrite: boolean, now = new Date()): { data: unknown; error: null } | { data: null; error: { message: string; code?: string } } | null {
  if (!["dpdp_icp_prove_overview", "dpdp_icp_evidence_pack", "dpdp_icp_evidence_add", "dpdp_icp_evidence_withdraw", "dpdp_icp_breach_log", "dpdp_icp_breach_update", "dpdp_icp_request_log", "dpdp_icp_request_close", "dpdp_icp_erasure_log", "dpdp_icp_erasure_close"].includes(fn)) return null
  if (!canWrite) return fail("Only the people who see the whole organisation can change this", "42501")
  const st = icpOf(host)
  const ps = proveState(host)
  const week = mondayOf(now)
  const today = day(now)
  switch (fn) {
    case "dpdp_icp_prove_overview": return ok(proveOverview(host, now))
    case "dpdp_icp_evidence_add": {
      const p = (args?.p ?? {}) as EvidenceInput & Record<string, unknown>
      const kind = String(p.kind ?? "other")
      const title = String(p.title ?? "").trim()
      const reference = text(p.reference), filename = text(p.filename), sha = text(p.sha256)?.toLowerCase() ?? null
      if (!EVIDENCE_KINDS.includes(kind)) return fail("Pick what kind of record this is", "22023")
      if (title.length < 2 || title.length > 120) return fail("Give it a short title (2 to 120 characters)", "22023")
      if ((reference ?? "").length > 200 || (filename ?? "").length > 200) return fail("Where it is kept can be 200 characters at most", "22023")
      if ([title, reference, filename].some((x) => x && looksLikePerson(x))) return fail(contactMsg, "22023")
      if (sha && !/^[0-9a-f]{64}$/.test(sha)) return fail("The fingerprint must be 64 letters and digits (SHA-256)", "22023")
      if (!sha && !reference) return fail("Add the file's fingerprint, or say where the original is kept", "22023")
      const on = text(p.evidenceOn) ?? today
      if (!/^\d{4}-\d{2}-\d{2}$/.test(on) || Number.isNaN(Date.parse(on))) return fail("Check the date and the size", "22023")
      if (on > day(new Date(now.getTime() + DAY)) || on < "2000-01-01") return fail("The date of the record looks wrong", "22023")
      const item = p.itemId ? st.items.find((i) => i.id === p.itemId) : undefined
      if (p.itemId && !item) return fail("That register line was not found", "P0002")
      const e: EvidenceWire = {
        id: `ev-mock-${++seq}`, kind: kind as EvidenceWire["kind"], title, reference, filename, sha256: sha, sizeBytes: typeof p.sizeBytes === "number" ? p.sizeBytes : null, evidenceOn: on,
        itemId: item?.id ?? null, itemName: item?.name ?? null, obligationId: text(p.obligationId), recordedAt: iso(now), withdrawn: false, withdrawnReason: null,
      }
      ps.evidence.push(e)
      if (kind === "agreement" && item?.kind === "vendor") { item.agreementStatus = "signed"; item.agreementRef = (reference ?? title).slice(0, 120); item.agreementOn = on }
      host.log("icp_evidence_recorded", "Recorded 1 piece of evidence")
      void week
      return ok({ ok: true, id: e.id })
    }
    case "dpdp_icp_evidence_withdraw": {
      const reason = String(args?.p_reason ?? "").trim()
      if (reason.length < 3 || reason.length > 200) return fail("Say in a few words why (3 to 200 characters)", "22023")
      if (looksLikePerson(reason)) return fail("Leave out e-mail addresses and phone numbers", "22023")
      const e = ps.evidence.find((x) => x.id === args?.p_evidence_id && !x.withdrawn)
      if (!e) return fail("That record was not found or is already withdrawn", "P0002")
      e.withdrawn = true; e.withdrawnReason = reason
      host.log("icp_evidence_withdrawn", "Withdrew 1 piece of evidence")
      return ok({ ok: true })
    }
    case "dpdp_icp_breach_log": {
      const p = (args?.p ?? {}) as BreachInput & Record<string, unknown>
      const desc = String(p.description ?? "").trim()
      if (desc.length < 5 || desc.length > 2000) return fail("Describe what happened in a few sentences (5 to 2000 characters)", "22023")
      if ([desc, p.nature, p.extent, p.location, p.likelyImpact].some((x) => typeof x === "string" && looksLikePerson(x))) return fail("Describe it without any person's e-mail address or phone number: the record lists what happened, not who", "22023")
      const aware = typeof p.becameAwareAt === "string" && p.becameAwareAt ? new Date(p.becameAwareAt) : now
      if (Number.isNaN(aware.getTime())) return fail("Check the date and the number of people", "22023")
      if (aware.getTime() > now.getTime() + 300_000 || aware.getTime() < now.getTime() - 365 * DAY) return fail("The date you became aware looks wrong", "22023")
      const people = typeof p.peopleAffected === "number" ? p.peopleAffected : null
      if (people !== null && (people < 0 || people > 1_000_000_000)) return fail("Check the number of people", "22023")
      const due = new Date(aware.getTime() + 72 * 3_600_000)
      const b: BreachWire = {
        id: `br-mock-${++seq}`, state: "open", becameAwareAt: iso(aware), boardDetailDueAt: iso(due), certInDueAt: iso(new Date(aware.getTime() + 6 * 3_600_000)), peopleAffected: people, description: desc,
        boardNotifiedAt: null, boardDetailedAt: null, individualsNotifiedAt: null, certInReportedAt: null, certInReference: null, pastClock: false,
      }
      ps.breaches.push(b)
      host.log("breach_recorded", "A personal data breach was recorded")
      return ok({ ok: true, id: b.id, boardDetailDueAt: b.boardDetailDueAt, certInDueAt: b.certInDueAt })
    }
    case "dpdp_icp_breach_update": {
      const p = (args?.p ?? {}) as BreachUpdate & Record<string, unknown>
      const b = ps.breaches.find((x) => x.id === args?.p_breach_id)
      if (!b) return fail("That record was not found", "P0002")
      if (b.state === "closed") return fail("This breach record is closed", "55000")
      if ([p.certInReference, p.mitigation, p.cause, p.remedialSteps].some((x) => typeof x === "string" && looksLikePerson(x))) return fail("Leave out any person's e-mail address or phone number", "22023")
      const stamp = iso(now)
      if (p.boardNotified) b.boardNotifiedAt ??= stamp
      if (p.boardDetailed) b.boardDetailedAt ??= stamp
      if (p.individualsNotified) b.individualsNotifiedAt ??= stamp
      if (p.certInReported) b.certInReportedAt ??= stamp
      if (text(p.certInReference)) b.certInReference = text(p.certInReference)
      if (typeof p.peopleAffected === "number") b.peopleAffected = p.peopleAffected
      if (p.closed && !b.boardDetailedAt) return fail("Record the detailed report to the Board before closing this breach", "22023")
      if (p.closed) b.state = "closed"
      host.log("breach_updated", p.closed ? "Closed a personal data breach record" : "Updated a personal data breach record")
      return ok({ ok: true })
    }
    case "dpdp_icp_request_log": {
      const p = (args?.p ?? {}) as RequestInput & Record<string, unknown>
      const type = String(p.type ?? "")
      if (!REQUEST_TYPES.includes(type)) return fail("Pick the kind of request", "22023")
      const via = (text(p.arrivedVia) ?? "other") as ArrivedVia
      if (!["in_person", "email", "post", "phone", "portal", "other"].includes(via)) return fail("Pick how it arrived", "22023")
      const on = text(p.receivedOn) ?? today
      if (!/^\d{4}-\d{2}-\d{2}$/.test(on) || Number.isNaN(Date.parse(on))) return fail("Check the date it arrived", "22023")
      if (on > day(new Date(now.getTime() + DAY)) || on < day(new Date(now.getTime() - 365 * DAY))) return fail("The date it arrived looks wrong", "22023")
      const summary = text(p.summary)
      if (type === "grievance") {
        if (!summary || summary.length < 3 || summary.length > 300) return fail("Say in a few words what it is about (3 to 300 characters)", "22023")
        if (looksLikePerson(summary)) return fail("Leave out the person's e-mail address and phone number: the log keeps the subject, not who", "22023")
      }
      const due = day(new Date(Date.parse(`${on}T00:00:00Z`) + 90 * DAY))
      const ref = `${type === "grievance" ? "GR" : "RR"}-${(++seq).toString(16).padStart(8, "0").toUpperCase()}`
      ps.requests.push({ ref, type: type as RequestWire["type"], arrivedVia: via, ...(type === "grievance" ? { summary: summary ?? "" } : {}), receivedOn: on, dueOn: due, state: "open", outcome: null, pastDue: false })
      host.log("icp_request_logged", type === "grievance" ? "Logged a grievance" : "Logged a request from a person")
      return ok({ ok: true, ref, dueOn: due })
    }
    case "dpdp_icp_request_close": {
      const outcome = String(args?.p_outcome ?? "") as RequestOutcome
      if (!OUTCOMES.includes(outcome)) return fail("Pick how it was answered", "22023")
      const r = ps.requests.find((x) => x.ref === args?.p_ref && x.state === "open")
      if (!r) return fail("That request was not found or is already answered", "P0002")
      r.state = "answered"; r.outcome = outcome
      host.log("icp_request_answered", "Answered a request")
      return ok({ ok: true })
    }
    case "dpdp_icp_erasure_log": {
      const p = (args?.p ?? {}) as ErasureInput & Record<string, unknown>
      const scope = String(p.scope ?? "").trim()
      if (scope.length < 2 || scope.length > 160) return fail("Say what is to be erased (2 to 160 characters)", "22023")
      if (looksLikePerson(scope)) return fail("Name the data set, not a person: leave out e-mail addresses and phone numbers", "22023")
      const trigger = text(p.trigger) ?? "other"
      if (!TRIGGERS.includes(trigger)) return fail("Pick why this erasure is needed", "22023")
      const due = text(p.dueOn) ?? day(new Date(now.getTime() + 30 * DAY))
      if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || Number.isNaN(Date.parse(due))) return fail("Check the due date", "22023")
      if (due < day(new Date(now.getTime() - 365 * DAY)) || due > day(new Date(now.getTime() + 3650 * DAY))) return fail("The due date looks wrong", "22023")
      if (p.itemId && !st.items.some((i) => i.id === p.itemId)) return fail("That register line was not found", "P0002")
      const e: ErasureWire = { id: `er-mock-${++seq}`, scope, trigger: trigger as ErasureWire["trigger"], dueOn: due, state: "open", doneOn: null, method: null, pastDue: false, itemId: text(p.itemId) }
      ps.erasures.push(e)
      host.log("icp_erasure_logged", "Logged 1 erasure to do")
      return ok({ ok: true, id: e.id })
    }
    case "dpdp_icp_erasure_close": {
      const p = (args?.p ?? {}) as { state?: string; doneOn?: string; method?: string }
      if (!p.state) return fail("Say whether it was done or is not needed", "22023")
      const state = p.state
      if (state !== "done" && state !== "not_needed") return fail("Say whether it was done or is not needed", "22023")
      const method = text(p.method)
      if (state === "not_needed" && !method) return fail("Say why it is not needed", "22023")
      if (method && (method.length > 160 || looksLikePerson(method))) return fail("Leave out e-mail addresses and phone numbers", "22023")
      const on = text(p.doneOn) ?? today
      if (!/^\d{4}-\d{2}-\d{2}$/.test(on) || Number.isNaN(Date.parse(on))) return fail("Check the date", "22023")
      const e = ps.erasures.find((x) => x.id === args?.p_erasure_id && x.state === "open")
      if (!e) return fail("That erasure was not found or is already closed", "P0002")
      e.state = state; e.doneOn = on; e.method = method
      host.log("icp_erasure_closed", state === "done" ? "Marked 1 erasure done" : "Marked 1 erasure not needed")
      return ok({ ok: true })
    }
    case "dpdp_icp_evidence_pack": return ok(mockPack(host, now))
    default: return null
  }
}

function mockPack(host: IcpMockHost, now: Date): EvidencePack {
  const st = icpOf(host)
  const o = proveOverview(host, now)
  const done = 0
  void done
  return {
    what: "Evidence pack: the organisation's own records, as kept in VERIDIAN DPDP. It lists what the organisation recorded and when. It is not a certificate and not a legal opinion.",
    organisation: "Your organisation", generatedAt: iso(now), weekStart: o.weekStart, status: { done: 0, total: 0, percent: 0 },
    register: st.items.filter((i) => i.status === "active").map((i) => ({ kind: i.kind, name: i.name, whereHeld: i.whereHeld, principalType: i.principalType, children: i.children, lawfulBasis: i.lawfulBasis, retentionDays: i.retentionDays, retentionNote: i.retentionNote, flags: i.flags })),
    retiredLines: st.items.filter((i) => i.status === "retired").length, evidence: o.evidence, notices: [],
    consent: { campaigns: 0, linksIssued: 0, linksAnswered: 0, answersGiven: 0, answersRefusedOrWithdrawn: 0 },
    breaches: o.breaches.map((b) => { const c: Record<string, unknown> = { ...b }; delete c.description; return c as Omit<BreachWire, "description"> }), requests: o.requests.map((q) => { const c: Record<string, unknown> = { ...q }; delete c.summary; return c as Omit<RequestWire, "summary"> }), vendors: o.vendors, erasures: o.erasures,
    jobs: host.rows.map((r) => ({ job: r.dataSet || `Job ${r.libIndex}`, state: r.na ? "not_applicable" : r.yes ? "closed" : "open", dueOn: r.due.slice(0, 10), closedAt: null })),
    weeklyRecord: st.runs.map((r) => ({ stage: r.stage, weekStart: r.weekStart, ranAt: r.ranAt, byKind: r.byKind, outcome: r.outcome, percent: r.percent })),
    history: { events: host.eventsThisWeek, checked: host.eventsThisWeek, linksBroken: 0, hashesWrong: 0, intact: true, headHash: null, firstAt: null, lastAt: null },
    limits: ["Documents are not kept by VERIDIAN: the fingerprint, name and reference are the organisation's own entries, recorded by the organisation.", "A file that gives the same fingerprint today is the same file that gave it when the organisation recorded it. VERIDIAN did not see the file and cannot check how the fingerprint was made, and a fingerprint does not show the file is correct.", "The date of a record is the date the organisation entered for it; the \"recorded in VERIDIAN\" time is set by VERIDIAN and cannot be changed.", "The pack is built not to contain any person's e-mail address or phone number, and the weekly record, the breach log and the request log hold no free text about a person. The organisation's own titles and notes are shown as it wrote them."],
  }
}
