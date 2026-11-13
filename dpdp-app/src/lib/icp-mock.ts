// The weekly ICP routine for the OFFLINE MOCK client (mock-client.ts): the same rules the database runs (drizzle/0761), over in-memory state, so the screens
// and the browser tests behave the way the live ones do. Nothing here is used against a real database. Rules are shared with the e-mail and the unit
// tests through icp.ts (itemFlags); the SQL has a parity test in src/lib/services/dpdp-icp-identify-classify.pglite.test.ts.
import { addDaysISO, FLAG_TEXT, itemFlags, isClassified, looksLikePerson, mondayOf, type IcpItem, type IcpItemInput, type IcpKind, type IcpRunWire, type IcpSection, type IcpStage, type IcpStatus, type IcpStep } from "./icp"
import { proveCounts, proveRpc, type ProveMockState } from "./icp-prove-mock"

export type IcpMockState = { items: IcpItem[]; runs: IcpRunWire[]; childConsentAnswered: boolean; prove?: ProveMockState }
export type IcpMockRow = { libIndex: number; part: number; dataSet: string; na: boolean; yes: boolean; due: string }
export type IcpMockHost = {
  product: "firm" | "institution"; rows: IcpMockRow[]; icp?: IcpMockState
  /** How many History entries the organisation has written since the start of the week. */
  eventsThisWeek: number
  log: (kind: string, summary: string) => void
}
type Result = { data: unknown; error: null } | { data: null; error: { message: string; code?: string } }
const ok = (data: unknown): Result => ({ data, error: null })
const fail = (message: string, code?: string): Result => ({ data: null, error: { message, code } })

/** institution-07, 08, 11, 12, 13, 21, 22, 25, 27: the children's-data jobs (dpdp.icp_children_job_keys()). */
export const CHILDREN_JOB_INDEXES = [7, 8, 11, 12, 13, 21, 22, 25, 27]

const step = (key: string, label: string, done: boolean, count: number | null, action: string | null): IcpStep => ({ key, label, done, count, action })
const section = (steps: IcpStep[]): IcpSection => ({ done: steps.filter((s) => s.done).length, total: steps.length, steps })
const withFlags = (host: IcpMockHost, i: IcpItem, week: string): IcpItem => ({ ...i, flags: itemFlags(i, week, host.icp!.childConsentAnswered).map((key) => ({ key, text: FLAG_TEXT[key] ?? key })) })
const state = (host: IcpMockHost): IcpMockState => (host.icp ??= { items: [], runs: [], childConsentAnswered: false })

/** The checklist, mirroring dpdp.icp_identify / icp_classify / icp_prove. PROVE grows with the later rounds. */
export function icpStatus(host: IcpMockHost, now = new Date()): IcpStatus {
  const st = state(host)
  const week = mondayOf(now)
  const active = st.items.filter((i) => i.status === "active")
  const unconfirmed = active.filter((i) => (i.lastConfirmedWeek ?? "1900-01-01") < week && i.firstSeenWeek < week).length
  const newThisWeek = active.filter((i) => i.firstSeenWeek === week).length
  const logged = st.runs.some((r) => r.weekStart === week && r.stage === "identify" && r.outcome === "skipped" && r.byKind === "person")
  const identify = section([
    step("register_started", "Start your register: list what you hold, where, and who holds it", active.length > 0, active.length, "register"),
    step("confirm_register", "Check each line of your register is still true", active.length > 0 && unconfirmed === 0, unconfirmed, "register"),
    step("anything_new", "Add anything new this week, or say there is nothing new", newThisWeek > 0 || logged, newThisWeek, "register"),
  ])
  let unclassified = 0, childFlags = 0, vendorFlags = 0
  for (const i of active) {
    const f = itemFlags(i, week, st.childConsentAnswered)
    if (f.includes("unclassified")) unclassified++
    if (f.includes("children_basis_missing") || f.includes("children_consent_not_collected")) childFlags++
    if (f.includes("vendor_agreement_missing")) vendorFlags++
  }
  const hasChildren = active.some((i) => i.children === true && (i.kind === "data_set" || i.kind === "person_group"))
  const jobsOff = hasChildren && host.product === "institution" ? host.rows.filter((r) => r.na && CHILDREN_JOB_INDEXES.includes(r.libIndex)).length : 0
  const classify = section([
    step("classify_items", "Classify every line: whose data, children or not, why, on what basis, for how long", unclassified === 0 && active.length > 0, unclassified, "register"),
    step("children_rules", "Settle the basis for children's data (parental consent or the educational purpose)", childFlags === 0, childFlags, "register"),
    step("vendor_rules", "Outside helpers: an agreement on record for each", vendorFlags === 0, vendorFlags, "register"),
    step("jobs_follow_register", "Children's-data jobs switched on where the register lists children", jobsOff === 0, jobsOff, "rules"),
  ])
  const c = proveCounts(host, now)
  const prove = section([
    step("jobs_not_late", "No job is late", c.jobsLate === 0, c.jobsLate, "jobs"),
    step("evidence_this_week", "Attach this week's records (or say there is nothing to attach)", c.evidenceThisWeek > 0 || c.nothingToAttach, c.evidenceThisWeek, "evidence"),
    step("agreements_on_record", "Each signed agreement with an outside helper has its record attached", c.agreementsWithoutEvidence === 0, c.agreementsWithoutEvidence, "evidence"),
    step("breach_clocks", "No open breach is past its 72-hour report to the Board", c.breachesPastClock === 0, c.breachesPastClock, "breach"),
    step("requests_on_time", "No request or grievance is past its due date", c.requestsPastDue === 0, c.requestsPastDue, "requests"),
    step("erasures_on_time", "No erasure is past its due date", c.erasuresPastDue === 0, c.erasuresPastDue, "erasure"),
    step("week_signed_off", "A person signs off the week", c.signed, null, "signoff"),
  ])
  const done = identify.done + classify.done + prove.done
  const total = identify.total + classify.total + prove.total
  return {
    weekStart: week, identify, classify, prove, done, total, percent: total === 0 ? 0 : Math.round((100 * done) / total),
    status: done === 0 ? "not_started" : done === total ? "complete" : "in_progress", notALegalRating: true,
    runs: st.runs.filter((r) => r.weekStart >= addDaysISO(week, -28)).slice().sort((a, b) => b.ranAt.localeCompare(a.ranAt)),
  }
}

const KINDS: IcpKind[] = ["data_set", "system", "vendor", "person_group"]
let seq = 0

/** One RPC. `canWrite` is false for a staff view (the database refuses them with the same sentence). Returns null for a function this module does not own. */
export function icpRpc(host: IcpMockHost, fn: string, args: Record<string, unknown> | undefined, canWrite: boolean, now = new Date()): Result | null {
  if (!fn.startsWith("dpdp_icp_")) return null
  const st = state(host)
  const week = mondayOf(now)
  // every ICP function is for the people who see the whole organisation (a staff member sees only their own jobs)
  if (!canWrite) return fail("Only the people who see the whole organisation can change this", "42501")
  switch (fn) {
    case "dpdp_icp_status": return ok(icpStatus(host, now))
    case "dpdp_icp_register": return ok(st.items.filter((i) => i.status === "active").map((i) => withFlags(host, i, week)).sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)))
    case "dpdp_icp_save_item": {
      const p = (args?.p_item ?? {}) as IcpItemInput & Record<string, unknown>
      let item: IcpItem | undefined
      if (!p.id) {
        const kind = p.kind as IcpKind
        const name = String(p.name ?? "").replace(/\s+/g, " ").trim()
        if (!KINDS.includes(kind)) return fail("Say whether this is a data set, a system, an outside helper or a group of people", "22023")
        if (!name) return fail("Give it a name", "22023")
        if (looksLikePerson(name)) return fail("Name the kind of data or the system, not a person: no e-mail address or phone number here", "22023")
        if (st.items.some((x) => x.status === "active" && x.kind === kind && x.name.toLowerCase() === name.toLowerCase())) return fail("That is already in your register", "P0001")
        item = {
          id: `icp-mock-${++seq}`, kind, name, whereHeld: null, holderLabel: null, status: "active", source: "manual", firstSeenWeek: week, lastConfirmedWeek: null,
          principalType: null, children: null, purpose: null, lawfulBasis: null, sensitivity: null, retentionDays: null, retentionNote: null, recipients: null,
          agreementStatus: null, agreementRef: null, agreementOn: null, flags: [],
        }
        st.items.push(item)
      } else {
        item = st.items.find((x) => x.id === p.id && x.status === "active")
        if (!item) return fail("Not found in your register", "P0002")
        if (typeof p.name === "string") {
          const n = p.name.replace(/\s+/g, " ").trim()
          if (looksLikePerson(n)) return fail("Name the kind of data or the system, not a person: no e-mail address or phone number here", "22023")
          if (n) item.name = n
        }
      }
      const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null)
      for (const k of ["whereHeld", "holderLabel", "purpose", "retentionNote", "recipients", "agreementRef"]) {
        const v = (p as Record<string, unknown>)[k]
        if (typeof v === "string" && looksLikePerson(v)) return fail("That looks like a person's e-mail address or phone number. The register holds names of things, never a person's contact", "22023")
      }
      if (("lawfulBasis" in p && p.lawfulBasis && !["consent", "legitimate_use", "legal_obligation", "state_function", "employment", "child_exemption", "not_sure"].includes(String(p.lawfulBasis)))
        || ("principalType" in p && p.principalType && !["student", "parent_guardian", "staff", "applicant", "alumni", "client_staff", "customer", "visitor", "other"].includes(String(p.principalType)))) return fail("Pick one of the choices offered", "22023")
      if ("retentionDays" in p && typeof p.retentionDays === "number" && (!Number.isInteger(p.retentionDays) || p.retentionDays < 1 || p.retentionDays > 36500)) return fail("Keep for a whole number of days, between 1 and 36500", "22023")
      if ("whereHeld" in p) item.whereHeld = text(p.whereHeld)
      if ("holderLabel" in p) item.holderLabel = text(p.holderLabel)
      if ("principalType" in p) item.principalType = (text(p.principalType) as IcpItem["principalType"]) ?? null
      if ("children" in p) item.children = typeof p.children === "boolean" ? p.children : null
      if ("purpose" in p) item.purpose = text(p.purpose)
      if ("lawfulBasis" in p) item.lawfulBasis = (text(p.lawfulBasis) as IcpItem["lawfulBasis"]) ?? null
      if ("sensitivity" in p) item.sensitivity = (text(p.sensitivity) as IcpItem["sensitivity"]) ?? null
      if ("retentionDays" in p) item.retentionDays = typeof p.retentionDays === "number" ? p.retentionDays : null
      if ("retentionNote" in p) item.retentionNote = text(p.retentionNote)
      if ("recipients" in p) item.recipients = text(p.recipients)
      if ("agreementStatus" in p) item.agreementStatus = (text(p.agreementStatus) as IcpItem["agreementStatus"]) ?? null
      if ("agreementRef" in p) item.agreementRef = text(p.agreementRef)
      if ("agreementOn" in p) item.agreementOn = text(p.agreementOn)
      void isClassified
      host.log(p.id ? "icp_item_changed" : "icp_item_added", `${p.id ? "Updated a" : "Added a"} ${item.kind.replace("_", " ")} ${p.id ? "in" : "to"} the register`)
      return ok({ ok: true, item: withFlags(host, item, week) })
    }
    case "dpdp_icp_retire_item": {
      const reason = String(args?.p_reason ?? "").trim()
      if (!reason || reason.length > 200) return fail("Say in a few words why it is no longer held (up to 200 characters)", "22023")
      const item = st.items.find((x) => x.id === args?.p_item_id && x.status === "active")
      if (!item) return fail("Not found in your register", "P0002")
      if (looksLikePerson(reason)) return fail("That looks like a person's e-mail address or phone number. Leave it out", "22023")
      item.status = "retired"
      item.whereHeld = null; item.holderLabel = null; item.purpose = null; item.recipients = null; item.retentionNote = null; item.agreementRef = null
      host.log("icp_item_retired", `Took a ${item.kind.replace("_", " ")} off the register`)
      return ok({ ok: true })
    }
    case "dpdp_icp_confirm_items": {
      const ids = Array.isArray(args?.p_item_ids) ? (args?.p_item_ids as string[]) : null
      let n = 0
      for (const i of st.items) if (i.status === "active" && (!ids || ids.includes(i.id))) { i.lastConfirmedWeek = week; n++ }
      if (n > 0) host.log("icp_register_confirmed", `Confirmed ${n} register line(s) as still true this week`)
      return ok({ ok: true, confirmed: n })
    }
    case "dpdp_icp_starter": {
      let n = 0
      const names = [...new Set(host.rows.filter((r) => r.part === 2 && !r.na && r.dataSet.trim()).map((r) => r.dataSet.trim()))].sort()
      for (const name of names) {
        if (st.items.some((x) => x.status === "active" && x.kind === "data_set" && x.name.toLowerCase() === name.toLowerCase())) continue
        st.items.push({
          id: `icp-mock-${++seq}`, kind: "data_set", name, whereHeld: null, holderLabel: null, status: "active", source: "starter", firstSeenWeek: week, lastConfirmedWeek: null,
          principalType: null, children: null, purpose: null, lawfulBasis: null, sensitivity: null, retentionDays: null, retentionNote: null, recipients: null,
          agreementStatus: null, agreementRef: null, agreementOn: null, flags: [],
        })
        n++
      }
      if (n > 0) host.log("icp_register_started", `Started the register from the library: ${n} data set(s)`)
      return ok({ ok: true, added: n })
    }
    case "dpdp_icp_apply_rules": {
      const hasChildren = st.items.some((i) => i.status === "active" && i.children === true && (i.kind === "data_set" || i.kind === "person_group"))
      if (!hasChildren || host.product !== "institution") return ok({ ok: true, reopened: 0 })
      let n = 0
      for (const r of host.rows) if (r.na && CHILDREN_JOB_INDEXES.includes(r.libIndex)) { r.na = false; n++ }
      if (n > 0) host.log("icp_jobs_switched_on", `Switched ${n} children's-data job(s) back on, because the register lists children's data`)
      return ok({ ok: true, reopened: n })
    }
    case "dpdp_icp_log": {
      const stage = args?.p_stage as IcpStage
      if (!["identify", "classify", "prove"].includes(stage)) return fail("Unknown stage", "22023")
      const outcome = (args?.p_outcome ?? "ok") as IcpRunWire["outcome"]
      if (!["ok", "partial", "skipped"].includes(outcome)) return fail("Unknown outcome", "22023")
      const note = typeof args?.p_note === "string" && args.p_note.trim() ? args.p_note.trim() : null
      if (note && (note.length > 300 || looksLikePerson(note))) return fail("Leave out e-mail addresses and phone numbers", "22023")
      st.runs.push({ stage, weekStart: week, ranAt: now.toISOString(), byKind: "person", actor: "Owner", outcome, note, percent: icpStatus(host, now).percent })
      host.log("icp_stage_signed_off", outcome === "skipped" ? (stage === "identify" ? "Recorded: nothing new this week" : "Recorded: nothing to attach this week") : `Signed off ${stage[0].toUpperCase()}${stage.slice(1)} for the week`)
      return ok({ ok: true, weekStart: week })
    }
    default: return proveRpc(host, fn, args, canWrite, now)
  }
}
