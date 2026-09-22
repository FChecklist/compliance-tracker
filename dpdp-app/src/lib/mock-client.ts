import type { AuthListener, AuthSession, DpdpClient, RpcResult } from "./client"
import type { GroupAnswerKind } from "@/lib/dpdp-onepage/view-model"
import type { AreaAssignmentWire, AreaPayload, CaClientWire, HistoryEntryWire, MyPagePayload, MyPageRowWire, OrgSetupPayload, ShareRoleWire, ViewerKind } from "./rpc-types"

// VITE_MOCK=1: an in-memory stand-in for the public.dpdp_* RPCs so the
// whole loop (sign in -> owner's first-visit wizard -> jobs load -> Mark
// Yes -> History shows it -> reload shows it) can run with no Supabase
// credentials at all. State is mirrored into localStorage purely so a real
// browser reload still "shows it", the same way a real session + real DB
// would.
//
// v4 (WO-DPDP-011 Step 6, the 70 acceptance checks): the fixture is now the
// spec's OWN job library -- spec/veridian-dpdp.html's LIB.firm (31 jobs) and
// LIB.institution (28 jobs), copied verbatim: part, wording, area, due-in
// days, data set, data types, law codes, the group flag and the sign-off
// chain (owner confirms -> CA manager checks -> CA partner signs). Every
// number the acceptance suite asserts (part counts, "required today" tags,
// the Seal's "5 of 30") is derived from this library, never invented; the
// unit test beside this file (mock-client.test.ts) pins those derivations.
//
// WHO YOU ARE is the sign-in address (PERSONAS below): a real magic link
// carries exactly that, so the persona table is the closest honest stand-in
// for dpdp.identity. Anyone not in the table signs in as the home org's
// owner, as before.
//
// WHICH WORLD YOU ARE IN is `?mock=<scenario>` on /app/ (MOCK_SCENARIOS):
// it seeds a FRESH fixture for that scenario, discards any stored state,
// and signs the scenario's persona in directly (no 1.5 s inbox wait). It is
// read only here, only in mock mode -- the real client never sees it. A
// plain form sign-in with no `?mock=` keeps whatever state is stored (or
// the "owner" fixture if nothing is), so one test can sign out and sign
// back in as another persona against the same org, the way a real day
// goes. Reloading a `?mock=` URL re-seeds; to prove something PERSISTED,
// go to /app/ without the query.
const STORAGE_KEY = "dpdp-mock-state-v4"
const GO = "Grievance Officer (responsible for DPDP policy)"

export const MOCK_OWNER = "owner@example.test"
export const MOCK_PARTNER = "partner@example.test"
export const MOCK_MANAGER = "manager@example.test"
export const MOCK_CLIENT_OWNER = "client-owner@example.test"
export const MOCK_GO = "go@example.test"
export const MOCK_COORD = "coord@example.test"
export const MOCK_STAFF = "staff@example.test"
export const MOCK_HR = "hr@example.test"
export const MOCK_MEMBERS = ["member@example.test", "member2@example.test", "member3@example.test"] as const

// The fragment tokens the token pages accept in mock mode.
export const MOCK_TOKENS = { done: "mock-done", cannot: "mock-cannot", unsubscribe: "mock-unsub", parent: "mock-parent" } as const
export const MOCK_DRAFT = { draftId: "mock-draft", confirmToken: "mock-confirm" } as const
// WO-DPDP-014: the referral code every mock decision-maker gets (8 chars,
// the real code's alphabet -- no 0/O/1/I), and the share_press event's
// role labels, exactly as drizzle/0611 writes them.
export const MOCK_REFERRAL_CODE = "MOCK1234"
export const SHARE_ROLE_LABEL: Record<ShareRoleWire, string> = { owner: "Owner", partner: "CA partner", manager: "CA manager" }

export const MOCK_SCENARIOS = ["owner", "owner-live", "client-owner", "partner", "manager", "go", "coord", "staff", "hr", "member", "member2", "member3"] as const
export type MockScenario = (typeof MOCK_SCENARIOS)[number]
export function isMockScenario(s: string | null | undefined): s is MockScenario {
  return !!s && (MOCK_SCENARIOS as readonly string[]).includes(s)
}

type Persona = { kind: ViewerKind; caSub: "partner" | "manager" | null }
const PERSONAS: Record<string, Persona> = {
  [MOCK_OWNER]: { kind: "owner", caSub: null },
  [MOCK_CLIENT_OWNER]: { kind: "owner", caSub: null },
  [MOCK_PARTNER]: { kind: "ca", caSub: "partner" },
  [MOCK_MANAGER]: { kind: "ca", caSub: "manager" },
  [MOCK_GO]: { kind: "go", caSub: null },
  [MOCK_COORD]: { kind: "coord", caSub: null },
  [MOCK_STAFF]: { kind: "staff", caSub: null },
  [MOCK_HR]: { kind: "staff", caSub: null },
  "web@vendor.test": { kind: "staff", caSub: null },
  "cctv@example.test": { kind: "staff", caSub: null },
  "it@example.test": { kind: "staff", caSub: null },
}
for (const m of MOCK_MEMBERS) PERSONAS[m] = { kind: "staff", caSub: null }

// ---------------------------------------------------------------------
// The job library: spec/veridian-dpdp.html's LIB, verbatim. Each entry is
// [part, task, who looks after it, due in days, data set, data types, law
// codes, flags] exactly as the spec's J() takes them. Law codes -- d: DPDP
// Act 2023 / Rules 2025 (from 13 May 2027) · s: SPDI Rules 2011 (in force
// now) · a: Aadhaar Act 2016 (in force now) · g: good practice, not a
// legal duty.
// ---------------------------------------------------------------------
export type LibraryRow = { part: number; what: string; area: string; dueDays: number; dataSet: string; dataTypes: string[]; lawCodes: string[]; fromArea?: boolean; grp?: boolean; dep?: string }
function J(part: number, what: string, area: string, dueDays: number, dataSet: string, dataTypes: string[], lawCodes: string[], o: { fromArea?: boolean; grp?: boolean; dep?: string } = {}): LibraryRow {
  return { part, what, area, dueDays, dataSet, dataTypes, lawCodes, ...o }
}
export const LIBRARY: Record<"firm" | "institution", LibraryRow[]> = {
  firm: [
    J(1, "Name the " + GO, GO, 4, "Whole organisation", [], ["d:§8(9)", "d:§8(10)", "s:R5(9)"], { fromArea: true }),
    J(1, "Name a DPDP coordinator", "DPDP coordinator", 4, "Whole organisation", [], ["g:"], { fromArea: true }),
    J(1, "Publish the Grievance Officer’s name and contact — on your website or a free VERIDIAN page", GO, 10, "Whole organisation", [], ["d:§8(9)", "d:R9", "s:R5(9)"]),
    J(2, "Write down where it is kept, why you need it, and who can open it", "Customer data", 10, "Customers", ["Name", "Phone", "Email", "Address", "PAN", "Bank details"], ["d:§4", "d:§8(4)"]),
    J(2, "Write down where it is kept, why you need it, and who can open it", "Staff records", 10, "Employees", ["Name", "PAN", "Aadhaar", "Bank account", "Salary", "Photo", "Medical"], ["d:§7(i)", "d:§8(4)"]),
    J(2, "Write down where it is kept, why you need it, and who can open it", "Staff records", 12, "Job applicants", ["Name", "CV", "Phone", "Email"], ["d:§4", "d:§8(4)"]),
    J(2, "Write down where it is kept, why you need it, and who can open it", "Website firm", 12, "Website visitors", ["Name", "Phone", "Email", "Cookies"], ["d:§4", "d:§8(4)"]),
    J(2, "Write down where the recordings are kept and for how long", "CCTV", 12, "CCTV", ["Video of staff and visitors"], ["d:§4", "d:§8(7)"]),
    J(2, "Write down where fingerprints or face scans are stored and who can open them", "Staff records", 12, "Attendance machine", ["Fingerprint", "Face"], ["d:§8(5)", "s:R3"]),
    J(2, "Write down how long each is kept — keep only what tax and labour law require, delete the rest", "Accounts", 14, "All data sets", ["All"], ["d:§8(7)", "d:R8"]),
    J(3, "Give a privacy notice when you collect their data — on the form, invoice or website", "Customer data", 14, "Customers", ["All of the above"], ["d:§5", "d:R3", "s:R5(3)"]),
    J(3, "Take consent before sending marketing messages — and make stopping as easy as starting", "Customer data", 14, "Customers", ["Phone", "Email"], ["d:§6(1)", "d:§6(4)"]),
    J(3, "Tell staff what you hold and why — no consent is needed for employment", "Staff records", 14, "Employees", ["All of the above"], ["d:§5", "d:§7(i)"]),
    J(3, "Take written consent for sensitive data", "Staff records", 10, "Employees", ["Fingerprint", "Medical", "Bank account"], ["s:R5(1)"]),
    J(3, "Publish a privacy policy on the website", "Website firm", 10, "Website visitors", ["Cookies", "Form data"], ["s:R4", "d:§5", "d:R3"]),
    J(3, "Put up a notice wherever there is a camera", "CCTV", 10, "CCTV", ["Video"], ["d:§5"]),
    J(4, "Mask Aadhaar copies — keep only the last 4 digits visible", "Staff records", 10, "Employees · Customers", ["Aadhaar"], ["a:§29", "d:§8(5)", "d:R6"]),
    J(4, "Passwords on every computer, access only for those who need it, regular backups", "IT & computers", 14, "All data sets", ["All"], ["d:§8(5)", "d:R6", "s:R8"]),
    J(4, "Keep a record of who opened personal data — for at least one year", "IT & computers", 21, "All data sets", ["Access logs"], ["d:R6(1)(c)", "d:R8(3)"]),
    J(4, "Write down what to do if data leaks — tell the Board and every person affected, full report within 72 hours", GO, 21, "All data sets", ["All"], ["d:§8(6)", "d:R7"]),
    J(4, "Check your own laptop and phone for customer data — never forward it on personal WhatsApp", "All staff", 12, "Everyone", ["Customer data on personal devices"], ["d:§8(5)"], { grp: true }),
    J(5, "Website firm signs the data agreement", "Website firm", 12, "Website visitors", ["Enquiries"], ["d:§8(2)", "d:R6(1)(f)", "s:R7"]),
    J(5, "Payroll firm signs the data agreement", "Payroll firm", 12, "Employees", ["Bank account", "PAN", "Salary"], ["d:§8(2)", "d:R6(1)(f)", "s:R7"]),
    J(5, "Group company signs a data-sharing agreement", "Group company", 12, "Customers · Employees", ["Shared records"], ["d:§8(2)", "s:R7"]),
    J(5, "Check where your software keeps data — Tally, Zoho, Google — and whether it is outside India", "IT & computers", 21, "All data sets", ["All"], ["d:§8(2)", "d:§16", "d:R15"]),
    J(6, "Publish how people can ask to see, correct or delete their data", GO, 21, "All data sets", ["All"], ["d:§11", "d:§12", "d:R14(1)"]),
    J(6, "Answer every complaint within 90 days — within one month under today’s law", GO, 21, "All data sets", ["All"], ["d:§13", "d:R14(3)", "s:R5(9)"]),
    J(6, "Delete a customer’s data when they ask or when it is no longer needed — and tell anyone you shared it with", "Customer data", 21, "Customers", ["All"], ["d:§8(7)", "d:§12(3)"]),
    J(7, "Owner confirms all the answers are true", "OWNER", 25, "Whole organisation", [], ["d:§8(1)"]),
    J(7, "CA manager checks the proof", "CAMGR", 27, "Whole organisation", [], ["g:"], { dep: "Owner confirms all the answers are true" }),
    J(7, "CA partner signs the file", "CAPARTNER", 30, "Whole organisation", [], ["g:"], { dep: "CA manager checks the proof" }),
  ],
  institution: [
    J(1, "Name the " + GO, GO, 4, "Whole school", [], ["d:§8(9)", "d:§8(10)"], { fromArea: true }),
    J(1, "Name a DPDP coordinator", "DPDP coordinator", 4, "Whole school", [], ["g:"], { fromArea: true }),
    J(1, "Publish the Grievance Officer’s name and contact — on the school website or a free VERIDIAN page", GO, 10, "Whole school", [], ["d:§8(9)", "d:R9"]),
    J(2, "Write down where it is kept — ERP, admission files, UDISE+ — and who can open it", "Admission office", 10, "Students", ["Name", "Date of birth", "Photo", "Address", "Aadhaar", "Marks", "Attendance", "Health", "Category"], ["d:§4", "d:§8(4)", "d:§9"]),
    J(2, "Write down where it is kept and who can open it", "Fees office", 10, "Parents", ["Name", "Phone", "Email", "Occupation", "Income"], ["d:§4", "d:§8(4)"]),
    J(2, "Write down where it is kept and who can open it", "Staff records", 10, "Staff", ["Name", "PAN", "Aadhaar", "Bank account", "Salary", "Medical"], ["d:§7(i)", "d:§8(4)"]),
    J(2, "Write down where they are — school phones, website, magazine, Instagram", "DPDP coordinator", 12, "Photos & videos", ["Children’s photos", "Videos"], ["d:§8(4)", "d:§9"]),
    J(2, "Write down what the bus system records and who can see it", "Transport in-charge", 12, "School buses", ["Live location", "Pickup address", "Parent phone"], ["d:§8(4)", "d:§9(3)", "d:R12"]),
    J(2, "Write down where recordings are kept and for how long", "CCTV", 12, "CCTV", ["Video of children and staff"], ["d:§4", "d:§8(7)"]),
    J(2, "Write down how long each is kept — admission and TC registers as your board requires; delete the rest", "Admission office", 14, "All data sets", ["All"], ["d:§8(7)", "d:R8"]),
    J(3, "Take verifiable consent from a parent at admission — the school exemption covers only tracking for learning and safety, not admission data", "Admission office", 14, "Students", ["All of the above"], ["d:§9(1)", "d:R10", "d:R12"]),
    J(3, "Take a separate Yes or No from parents for photos on the website, magazine and social media", "DPDP coordinator", 14, "Photos & videos", ["Children’s photos"], ["d:§6", "d:§9(1)"]),
    J(3, "Give parents a notice — what you hold, why, and how to complain", "DPDP coordinator", 14, "Parents", ["All"], ["d:§5", "d:R3"]),
    J(3, "Tell staff what you hold and why — no consent is needed for employment", "Staff records", 14, "Staff", ["All of the above"], ["d:§5", "d:§7(i)"]),
    J(3, "Put up a notice wherever there is a camera", "CCTV", 10, "CCTV", ["Video"], ["d:§5"]),
    J(4, "Mask Aadhaar copies — keep only the last 4 digits visible", "Admission office", 10, "Students · Staff", ["Aadhaar"], ["a:§29", "d:§8(5)", "d:R6"]),
    J(4, "Passwords on the ERP and every office computer, access only for those who need it, backups", "IT & computers", 14, "All data sets", ["All"], ["d:§8(5)", "d:R6"]),
    J(4, "Keep a record of who opened student data — for at least one year", "IT & computers", 21, "All data sets", ["Access logs"], ["d:R6(1)(c)", "d:R8(3)"]),
    J(4, "Write down what to do if data leaks — tell the Board and every family affected, full report within 72 hours", GO, 21, "All data sets", ["All"], ["d:§8(6)", "d:R7"]),
    J(4, "Check your own laptop and phone for student photos and marks — never share them on personal WhatsApp", "Teachers", 12, "Teachers", ["Children’s photos", "Marks"], ["d:§8(5)", "d:§9"], { grp: true }),
    J(4, "No ads, profiling or tracking of children beyond learning and safety", "DPDP coordinator", 21, "Students", ["Behaviour", "Online activity"], ["d:§9(3)", "d:R12"]),
    J(5, "Bus firm signs the data agreement — location only during the journey, only for safety", "Bus firm", 12, "School buses", ["Live location"], ["d:§8(2)", "d:R12"]),
    J(5, "School software firm signs the data agreement", "School software firm", 12, "Students · Parents", ["Marks", "Attendance", "Fees"], ["d:§8(2)", "d:R6(1)(f)"]),
    J(5, "Check where your apps keep data — ERP, fee app, WhatsApp groups — and whether it is outside India", "IT & computers", 21, "All data sets", ["All"], ["d:§8(2)", "d:§16", "d:R15"]),
    J(6, "Publish how parents can ask to see, correct or delete their child’s data", GO, 21, "All data sets", ["All"], ["d:§11", "d:§12", "d:R14(1)"]),
    J(6, "Answer every complaint within 90 days", GO, 21, "All data sets", ["All"], ["d:§13", "d:R14(3)"]),
    J(6, "Delete a student’s data when it is no longer needed — keep the registers your board requires", "Admission office", 21, "Students", ["All"], ["d:§8(7)", "d:§12(3)"]),
    J(7, "Sign off all the answers", "OWNER", 25, "Whole school", [], ["d:§8(1)"]),
  ],
}
const NOT_AN_AREA = new Set(["OWNER", "CAMGR", "CAPARTNER"])
const GROUP_LABEL = { firm: "All staff", institution: "All teachers" } as const

// ---------------------------------------------------------------------
// Org fixtures. Three worlds for the home org "Sharma & Associates", plus a
// real client org so a CA's "Open" lands on a different page:
//   fresh  -- nothing named yet except the sign-off chain; the owner's
//             first visit is the 3-step wizard.
//   live   -- set up: LIVE_AREAS named, 3 people in the "All staff" group,
//             5 jobs done, 1 marked "doesn't apply", 1 with nobody, 3 late.
//             The owner has seen the page; everyone else is newly invited.
//   ca-set-up -- the live assignment, made by the CA partner, owner not
//             yet confirmed: the owner's first visit is the review screen.
// ---------------------------------------------------------------------
const HOME_ORG = "org-mock"
const HOME_NAME = "Sharma & Associates"
const CLIENT_ORG = "org-mehta"

const LIVE_AREAS: Record<string, string | "NA"> = {
  [GO]: MOCK_GO,
  "DPDP coordinator": MOCK_COORD,
  "Customer data": MOCK_STAFF,
  "Staff records": MOCK_HR,
  "Website firm": "web@vendor.test",
  CCTV: "cctv@example.test",
  Accounts: MOCK_COORD,
  "IT & computers": "it@example.test",
  "Payroll firm": "NA",
  // "Group company" is deliberately left off: one job with nobody named.
}
// The client org is fully staffed (nobody named = 0, nothing n/a), so its
// "4 of 31 done" and "In progress" read exactly as the Step 5 fixture did.
const CLIENT_AREAS: Record<string, string | "NA"> = { ...LIVE_AREAS, "Payroll firm": "payroll@mehtatraders.example", "Group company": "ops@mehtatraders.example" }

type StoredRow = {
  id: string; libIndex: number; part: number; what: string; area: string; dataSet: string; dataTypes: string[]; lawCodes: string[]
  by: string | null; isGroup: boolean; due: string; yes: boolean; na: boolean; dependsOnObligationId: string | null
}
type ViewerFlags = { firstVisitSeenAt: string | null; saidNotMeAt: string | null }
type OrgState = {
  id: string; name: string; product: "firm" | "institution"; ownerEmail: string; client: boolean
  rows: StoredRow[]; groupMembers: string[]; groupAnswers: Record<string, Record<string, GroupAnswerKind>>
  history: HistoryEntryWire[]; setUpBy: { membershipId: string; email: string } | null; ownerConfirmedAt: string | null
  viewers: Record<string, ViewerFlags>
}
type State = {
  signedInAs: string | null
  orgs: Record<string, OrgState>
  spentTokens: string[]; consentAnswered: boolean; unsubscribed: boolean; draftConfirmed: boolean; aiLinks: number
}

function daysFromNow(n: number): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + n)
  return d.toISOString()
}
const pad2 = (n: number) => (n < 10 ? "0" : "") + n
const rowId = (orgId: string, libIndex: number) => `${orgId}:f${pad2(libIndex)}`

type MakeOrg = {
  owner: string; client?: boolean; manager?: string | null; partner?: string | null
  areas?: Record<string, string | "NA">; group?: readonly string[]; done?: number[]; due?: Record<number, number>
  setUpBy?: { membershipId: string; email: string } | null; ownerConfirmedAt?: string | null; seenBy?: readonly string[]
}
function makeOrg(id: string, name: string, product: "firm" | "institution", o: MakeOrg): OrgState {
  const lib = LIBRARY[product]
  const areas = o.areas ?? {}
  const rows: StoredRow[] = lib.map((x, i) => {
    const n = i + 1
    let by: string | null = null
    let na = false
    let isGroup = false
    let yes = (o.done ?? []).includes(n)
    if (x.area === "OWNER") by = o.owner || null
    else if (x.area === "CAMGR") by = o.manager ?? null
    else if (x.area === "CAPARTNER") by = o.partner ?? null
    else if (x.fromArea) {
      // The spec: naming the GO / coordinator is itself the job -- it is
      // the owner's, and done the moment someone is named.
      if (areas[x.area]) { by = o.owner; yes = true }
    } else if (x.grp) {
      if (o.group?.length) { by = GROUP_LABEL[product]; isGroup = true }
    } else if (areas[x.area] === "NA") na = true
    else if (areas[x.area]) by = areas[x.area]
    const due = o.due?.[n] ?? (yes ? -5 : x.dueDays)
    return { id: rowId(id, n), libIndex: n, part: x.part, what: x.what, area: x.area, dataSet: x.dataSet, dataTypes: x.dataTypes, lawCodes: x.lawCodes, by, isGroup, due: daysFromNow(due), yes, na, dependsOnObligationId: null }
  })
  for (const r of rows) {
    const dep = lib[r.libIndex - 1].dep
    if (dep) r.dependsOnObligationId = rows.find((y) => y.what === dep)?.id ?? null
  }
  const viewers: Record<string, ViewerFlags> = {}
  for (const e of o.seenBy ?? []) viewers[e] = { firstVisitSeenAt: daysFromNow(-1), saidNotMeAt: null }
  return {
    id, name, product, ownerEmail: o.owner, client: o.client ?? false, rows, groupMembers: [...(o.group ?? [])], groupAnswers: {},
    history: [], setUpBy: o.setUpBy ?? null, ownerConfirmedAt: o.ownerConfirmedAt ?? null, viewers,
  }
}

function freshHomeOrg(owner: string): OrgState {
  return makeOrg(HOME_ORG, HOME_NAME, "firm", { owner, manager: MOCK_MANAGER, partner: MOCK_PARTNER })
}
function liveHomeOrg(): OrgState {
  return makeOrg(HOME_ORG, HOME_NAME, "firm", {
    owner: MOCK_OWNER, manager: MOCK_MANAGER, partner: MOCK_PARTNER, areas: LIVE_AREAS, group: MOCK_MEMBERS,
    done: [5, 8, 18], due: { 4: -6, 15: -3, 24: -1 }, seenBy: [MOCK_OWNER],
  })
}
function caSetUpHomeOrg(): OrgState {
  return makeOrg(HOME_ORG, HOME_NAME, "firm", {
    owner: MOCK_CLIENT_OWNER, manager: MOCK_MANAGER, partner: MOCK_PARTNER, areas: LIVE_AREAS, group: MOCK_MEMBERS,
    setUpBy: { membershipId: `m-${HOME_ORG}-${MOCK_PARTNER}`, email: MOCK_PARTNER },
  })
}
function clientOrg(): OrgState {
  return makeOrg(CLIENT_ORG, "Mehta Traders", "firm", {
    owner: "kiran@mehtatraders.example", client: true, manager: MOCK_MANAGER, partner: MOCK_PARTNER, areas: CLIENT_AREAS, group: ["a@mehtatraders.example", "b@mehtatraders.example"],
    // The CA people have worked this client before (4 jobs done), so their
    // memberships here are past their first visit -- "Open" lands on the
    // client's page, not on the three steps again.
    done: [5, 8], ownerConfirmedAt: daysFromNow(-20), seenBy: ["kiran@mehtatraders.example", MOCK_PARTNER, MOCK_MANAGER],
  })
}

function fresh(): State {
  return { signedInAs: null, orgs: { [HOME_ORG]: freshHomeOrg(MOCK_OWNER), [CLIENT_ORG]: clientOrg() }, spentTokens: [], consentAnswered: false, unsubscribed: false, draftConfirmed: false, aiLinks: 0 }
}

/** The world `?mock=<scenario>` seeds, signed in as that scenario's persona. */
export function seedScenario(scenario: MockScenario): State {
  const s = fresh()
  switch (scenario) {
    case "owner":
      s.signedInAs = MOCK_OWNER
      break
    case "client-owner":
      s.orgs[HOME_ORG] = caSetUpHomeOrg()
      s.signedInAs = MOCK_CLIENT_OWNER
      break
    case "owner-live":
      s.orgs[HOME_ORG] = liveHomeOrg()
      s.signedInAs = MOCK_OWNER
      break
    default:
      s.orgs[HOME_ORG] = liveHomeOrg()
      s.signedInAs = `${scenario}@example.test`
  }
  return s
}

function load(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as State
  } catch {
    // private mode / blocked storage: fall through to a fresh fixture
  }
  return fresh()
}

function save(state: State) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // same as load(): storage is a convenience here, never a requirement
  }
}

const GROUP_ANSWER_LABEL: Record<GroupAnswerKind, string> = { done: "Done", never_had_any: "Doesn't apply to me", cannot: "I can't" }

// drizzle/0609's own "Where it is" labels, derived the same way: from the
// jobs, never stored.
function whereItIs(org: OrgState): string {
  const live = org.rows.filter((r) => !r.na)
  const done = live.filter((r) => r.yes).length
  const openOther = live.filter((r) => !r.yes && !NOT_AN_AREA.has(r.area)).length
  const openMgr = live.filter((r) => !r.yes && r.area === "CAMGR").length
  if (org.setUpBy && !org.ownerConfirmedAt) return "Waiting for the owner to confirm"
  if (done === 0) return "Not started"
  if (live.length > 0 && done === live.length) return "Signed off"
  if (openOther === 0 && openMgr === 0) return "Ready to sign"
  if (openOther === 0) return "With the CA manager"
  return "In progress"
}

export function createMockClient(scenario?: string): DpdpClient {
  const requested = scenario ?? (typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("mock") : null)
  const state: State = isMockScenario(requested) ? seedScenario(requested) : load()
  if (isMockScenario(requested)) save(state)

  const listeners = new Set<AuthListener>()
  const session = (): AuthSession | null => (state.signedInAs ? { user: { email: state.signedInAs } } : null)
  const emit = (event: string) => {
    const s = session()
    for (const l of listeners) l(event, s)
  }
  const ok = <T,>(data: T): RpcResult<T> => ({ data, error: null })
  const fail = (message: string): RpcResult => ({ data: null, error: { message } })
  const home = () => state.orgs[HOME_ORG]
  const orgOf = (orgId: unknown): OrgState | null => (orgId ? (state.orgs[String(orgId)] ?? null) : home())
  const rowOf = (id: unknown): { org: OrgState; row: StoredRow } | null => {
    for (const org of Object.values(state.orgs)) {
      const row = org.rows.find((r) => r.id === String(id ?? ""))
      if (row) return { org, row }
    }
    return null
  }
  // dpdp__append_event's mirror: newest first, actor = the signed-in email.
  const log = (org: OrgState, kind: string, summary: string, detail: string | null = null, actor: string | null = state.signedInAs) => {
    org.history.unshift({ id: `ev-${Date.now()}-${org.history.length}`, kind, summary, detail, actorLabel: actor ?? "system", occurredAt: new Date().toISOString() })
  }
  const flags = (org: OrgState, email: string): ViewerFlags => (org.viewers[email] ??= { firstVisitSeenAt: null, saidNotMeAt: null })
  // Who this address is in this org: its owner, one of the CA people named
  // on its sign-off chain, or a persona from the table. Nobody else is a
  // member -- the real RPC says so too.
  const viewerIn = (org: OrgState, me: string): Persona | null => {
    if (me === org.ownerEmail) return { kind: "owner", caSub: null }
    const caRow = org.rows.find((r) => (r.area === "CAMGR" || r.area === "CAPARTNER") && r.by === me)
    if (caRow) return { kind: "ca", caSub: caRow.area === "CAMGR" ? "manager" : "partner" }
    if (org.id !== HOME_ORG) return null
    return PERSONAS[me] ?? null
  }
  const blockedBy = (org: OrgState, row: StoredRow): boolean => {
    if (!row.dependsOnObligationId) return false
    const dep = org.rows.find((r) => r.id === row.dependsOnObligationId)
    return !!dep && !dep.yes && !dep.na
  }
  const toWire = (org: OrgState, row: StoredRow, me: string): MyPageRowWire => {
    const base: MyPageRowWire = {
      id: row.id, part: row.part, what: row.what, dataSet: row.dataSet, dataTypes: row.dataTypes.length ? row.dataTypes : null, lawCodes: row.lawCodes,
      by: row.by, isGroup: row.isGroup, due: row.due, yes: row.yes, na: row.na, dependsOnObligationId: row.dependsOnObligationId, sent: 0,
    }
    if (!row.isGroup) return base
    const answers = org.groupAnswers[row.id] ?? {}
    // The real RPC knows group membership from staff_group_member; here,
    // the signed-in address being on the list is that fact.
    return { ...base, groupTotal: org.groupMembers.length, groupDone: Object.keys(answers).length, viewerIsGroupMember: org.groupMembers.includes(me), myGroupAnswer: answers[me] ?? null }
  }
  const pageFor = (org: OrgState, me: string): MyPagePayload | null => {
    const who = viewerIn(org, me)
    if (!who) return null
    const f = flags(org, me)
    return {
      org: { id: org.id, name: org.name, product: org.product },
      viewer: { email: me, kind: who.kind, caSub: who.caSub, firstVisitSeenAt: f.firstVisitSeenAt, saidNotMeAt: f.saidNotMeAt, membershipId: `m-${org.id}-${me}` },
      rows: org.rows.map((r) => toWire(org, r, me)),
    }
  }
  // drizzle/0611's decision-maker gate: the org's owner, or a CA partner /
  // manager named on its sign-off chain. Everyone else is refused with the
  // RPC's own words -- coordinator, GO, staff, vendor, parent never share.
  const shareRoleIn = (org: OrgState, me: string): ShareRoleWire | null => {
    const who = viewerIn(org, me)
    if (who?.kind === "owner") return "owner"
    if (who?.kind === "ca" && who.caSub) return who.caSub
    return null
  }
  const emailActionRow = () => home().rows.find((r) => r.area === "OWNER")!
  const draftRow = () => home().rows.find((r) => r.area === "Customer data")!

  // The token functions (drizzle/0606 + 0609's parent consent) need no
  // session: the token is the credential, so they are answered before the
  // signed-in gate below, with { ok:false, reason } rather than an error.
  function tokenRpc(fn: string, args?: Record<string, unknown>): RpcResult | null {
    const token = String(args?.p_token ?? "")
    const org = home()
    switch (fn) {
      case "dpdp_preview_email_action": {
        const action = token === MOCK_TOKENS.done ? "done" : token === MOCK_TOKENS.cannot ? "cannot" : null
        if (!action) return ok({ ok: false, reason: "This link is not valid." })
        if (state.spentTokens.includes(token)) return ok({ ok: false, reason: "This link has already been used. Nothing has changed." })
        const row = emailActionRow()
        return ok({ ok: true, action, what: row.what, orgName: org.name, isGroup: false, alreadyDone: row.yes })
      }
      case "dpdp_apply_email_action": {
        const action = token === MOCK_TOKENS.done ? "done" : token === MOCK_TOKENS.cannot ? "cannot" : null
        if (!action) return ok({ ok: false, reason: "This link is not valid." })
        if (state.spentTokens.includes(token)) return ok({ ok: false, reason: "This link has already been used. Nothing has changed." })
        if (String(args?.p_answer) !== action) return ok({ ok: false, reason: "This link does not match that answer." })
        const row = emailActionRow()
        state.spentTokens.push(token)
        if (row.yes) {
          save(state)
          return ok({ ok: false, reason: "This job is already marked done. Nothing has changed." })
        }
        if (action === "done") {
          row.yes = true
          log(org, "obligation_accepted", `Said Yes to "${row.what}"`, null, org.ownerEmail)
        } else {
          log(org, "obligation_stuck", "Said they are stuck", `Pressed "I can't" on the Monday email for "${row.what}"`, org.ownerEmail)
        }
        save(state)
        return ok({ ok: true, obligationId: row.id, answer: action, what: row.what })
      }
      case "dpdp_unsubscribe": {
        if (token !== MOCK_TOKENS.unsubscribe) return ok({ ok: false, reason: "This link is not valid." })
        state.unsubscribed = true
        log(org, "membership_email_unsubscribed", `${org.ownerEmail} stopped the weekly email (statutory notices continue)`, null, org.ownerEmail)
        save(state)
        return ok({ ok: true, email: org.ownerEmail })
      }
      case "dpdp_parent_consent_preview": {
        if (token !== MOCK_TOKENS.parent) return ok({ ok: false, reason: "This link is not valid or has expired" })
        return ok({ ok: true, orgName: org.name, notice: { docKind: "privacy", version: "1.0", languages: ["en"] }, openedAt: new Date().toISOString(), actedAt: state.consentAnswered ? new Date().toISOString() : null, alreadyAnswered: state.consentAnswered })
      }
      case "dpdp_parent_consent": {
        const answer = String(args?.p_answer ?? "")
        if (answer !== "yes" && answer !== "no") return ok({ ok: false, reason: "That is not an answer this link can record." })
        if (token !== MOCK_TOKENS.parent) return ok({ ok: false, reason: "This link is not valid or has expired" })
        if (state.consentAnswered) return ok({ ok: false, reason: "This link has already been used. Nothing has changed." })
        state.consentAnswered = true
        log(org, "consent_recorded", "Recorded 1 answer(s)", null, "A person on a link")
        save(state)
        return ok({ ok: true, answer })
      }
      default:
        return null
    }
  }

  return {
    auth: {
      async getSession() {
        return { data: { session: session() } }
      },
      onAuthStateChange(cb) {
        listeners.add(cb)
        // supabase-js emits INITIAL_SESSION on subscribe; the app relies on it.
        queueMicrotask(() => cb("INITIAL_SESSION", session()))
        return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } }
      },
      async signInWithOtp({ email }) {
        const me = email.trim().toLowerCase()
        const org = home()
        // A persona (or the home org's owner) signs in as themself. Anyone
        // else becomes the home org's owner, as before: the owner's rows
        // and flags move to the new address.
        if (!PERSONAS[me] && me !== org.ownerEmail) {
          const previous = org.ownerEmail
          for (const r of org.rows) if (r.by === previous) r.by = me
          if (org.viewers[previous]) { org.viewers[me] = org.viewers[previous]; delete org.viewers[previous] }
          org.ownerEmail = me
        }
        state.signedInAs = me
        save(state)
        // A real magic link is an inbox round trip; signing in on a later
        // tick keeps the app's check-your-email state (and its "Send me a
        // new link" button) reachable in mock mode.
        setTimeout(() => emit("SIGNED_IN"), 1500)
        return { error: null }
      },
      async signOut() {
        state.signedInAs = null
        save(state)
        emit("SIGNED_OUT")
        return { error: null }
      },
    },
    async rpc(fn, args) {
      const viaToken = tokenRpc(fn, args)
      if (viaToken) return viaToken
      if (!state.signedInAs) return fail("Not a member of this organisation")
      const me = state.signedInAs
      switch (fn) {
        case "dpdp_my_page": {
          const org = orgOf(args?.p_org_id)
          const page = org && pageFor(org, me)
          return page ? ok(page) : fail("Not a member of this organisation")
        }
        case "dpdp_mark_done": {
          const hit = rowOf(args?.p_obligation_id)
          if (!hit) return fail("Job not found")
          const { org, row } = hit
          if (blockedBy(org, row)) return fail("Waiting — the step before this one isn't done yet")
          row.yes = true
          log(org, "obligation_accepted", `Said Yes to "${row.what}"`)
          save(state)
          return ok({ ok: true })
        }
        case "dpdp_acknowledge_welcome": {
          const org = orgOf(args?.p_org_id)
          if (!org || !viewerIn(org, me)) return fail("Not a member of this organisation")
          flags(org, me).firstVisitSeenAt = new Date().toISOString()
          log(org, "membership_first_visit_acknowledged", `${me} saw their DPDP jobs for the first time`)
          save(state)
          return ok({ ok: true })
        }
        case "dpdp_flag_not_me": {
          // drizzle/0604's dpdp_flag_not_me stamps BOTH first_visit_seen_at
          // and said_not_me_at -- so the waiting screen, not the welcome,
          // is what this person sees next.
          const org = orgOf(args?.p_org_id)
          if (!org || !viewerIn(org, me)) return fail("Not a member of this organisation")
          const now = new Date().toISOString()
          const f = flags(org, me)
          f.firstVisitSeenAt = now
          f.saidNotMeAt = now
          log(org, "membership_said_not_me", `${me} said this isn't them -- needs reassigning`)
          save(state)
          return ok({ ok: true })
        }
        case "dpdp_areas_for_product": {
          // Same grouping as the SQL: by area, in first-appearance order,
          // group flag if any job in the area is a group job. OWNER/CAMGR/
          // CAPARTNER are not areas, exactly as dpdp_areas_for_product.
          const product = String(args?.p_product ?? "firm") as "firm" | "institution"
          const areas = new Map<string, AreaPayload>()
          for (const x of LIBRARY[product] ?? LIBRARY.firm) {
            if (NOT_AN_AREA.has(x.area)) continue
            const a = areas.get(x.area) ?? { area: x.area, jobs: [], isGroup: false }
            a.jobs.push(x.what)
            if (x.grp) a.isGroup = true
            areas.set(x.area, a)
          }
          return ok([...areas.values()])
        }
        case "dpdp_complete_owner_first_visit": {
          const org = orgOf(args?.p_org_id)
          if (!org || viewerIn(org, me)?.kind !== "owner") return fail("Only the owner can do this")
          const assignments = (args?.p_assignments ?? []) as AreaAssignmentWire[]
          let assigned = 0
          let notApplicable = 0
          for (const a of assignments) {
            const rows = org.rows.filter((r) => r.area === a.area)
            if (!rows.length) continue
            if (a.na) {
              for (const r of rows) r.na = true
              log(org, "obligation_not_my_job", `Marked "${a.area}" as not applicable`)
              notApplicable++
              continue
            }
            const emails = [...new Set(a.emails.map((e) => e.trim().toLowerCase()).filter(Boolean))]
            if (!emails.length) continue
            if (rows.some((r) => LIBRARY[org.product][r.libIndex - 1].grp)) {
              org.groupMembers = emails
              for (const r of rows) { r.by = GROUP_LABEL[org.product]; r.isGroup = true }
              log(org, "membership_named_in_role", `Named ${emails.length} people to "${a.area}"`)
              assigned++
              continue
            }
            for (const r of rows) {
              if (LIBRARY[org.product][r.libIndex - 1].fromArea) { r.by = org.ownerEmail; r.yes = true } else r.by = emails[0]
            }
            log(org, "membership_named_in_role", `Named ${emails[0]} as ${a.area}`)
            assigned++
          }
          flags(org, me).firstVisitSeenAt = new Date().toISOString()
          save(state)
          return ok({ ok: true, assigned, notApplicable })
        }
        case "dpdp_assign_person": {
          const hit = rowOf(args?.p_obligation_id)
          if (!hit) return fail("Job not found")
          const { org, row } = hit
          if (viewerIn(org, me)?.kind !== "owner") return fail("Only the owner can do this")
          const email = String(args?.p_email ?? "").trim().toLowerCase()
          if (!email) return fail("An email address is required")
          if (row.yes) return fail("Already closed")
          if (row.na) return fail("Doesn't apply")
          row.by = email
          row.isGroup = false
          log(org, "obligation_assigned", `Assigned "${row.what}" to ${email}`)
          save(state)
          return ok({ ok: true })
        }
        case "dpdp_mark_not_applicable": {
          const hit = rowOf(args?.p_obligation_id)
          if (!hit) return fail("Job not found")
          const { org, row } = hit
          if (row.by !== me && viewerIn(org, me)?.kind !== "owner") return fail("Not your job")
          const reason = String(args?.p_reason ?? "").trim() || null
          row.na = true
          log(org, "obligation_not_my_job", `Marked "${row.what}" as not applicable`, reason)
          save(state)
          return ok({ ok: true })
        }
        case "dpdp_org_history": {
          const org = orgOf(args?.p_org_id)
          if (!org) return fail("Not a member of this organisation")
          const limit = Math.max(1, Math.min(Number(args?.p_limit ?? 15) || 15, 50))
          return ok(structuredClone(org.history.slice(0, limit)))
        }
        // --- WO-DPDP-011 Step 5 (drizzle/0609) ---
        case "dpdp_answer_group": {
          const hit = rowOf(args?.p_obligation_id)
          if (!hit) return fail("Job not found")
          const { org, row } = hit
          const answer = String(args?.p_answer ?? "") as GroupAnswerKind
          if (!(answer in GROUP_ANSWER_LABEL)) return fail("That is not an answer this job can record.")
          if (!row.isGroup) return fail("This job isn't assigned to a group")
          if (blockedBy(org, row)) return fail("Waiting — the step before this one isn't done yet")
          if (!org.groupMembers.includes(me)) return fail("You aren't a member of the group this job is assigned to")
          const answers = (org.groupAnswers[row.id] ??= {})
          answers[me] = answer
          const answered = Object.keys(answers).length
          const total = org.groupMembers.length
          const closed = answered >= total
          if (closed) row.yes = true
          log(org, answer === "cannot" ? "task_answer_refused" : "task_answered", `${me} answered "${GROUP_ANSWER_LABEL[answer]}" for "${row.what}" (${answered} of ${total})`)
          save(state)
          return ok({ ok: true, answered, total, closed })
        }
        case "dpdp_my_clients": {
          // Every client org where the caller is named CA partner/manager.
          const out: CaClientWire[] = []
          for (const org of Object.values(state.orgs)) {
            if (!org.client) continue
            const who = viewerIn(org, me)
            if (who?.kind !== "ca" || !who.caSub) continue
            const live = org.rows.filter((r) => !r.na)
            out.push({ org: { id: org.id, name: org.name, product: org.product }, caSub: who.caSub, done: live.filter((r) => r.yes).length, total: live.length, whereItIs: whereItIs(org), dataLocations: 0, ownerConfirmedAt: org.ownerConfirmedAt, setUpByMe: org.setUpBy?.email === me })
          }
          return ok(out)
        }
        case "dpdp_create_client_org": {
          const name = String(args?.p_name ?? "").trim()
          const product = String(args?.p_product ?? "")
          const ownerEmail = String(args?.p_owner_email ?? "").trim().toLowerCase()
          if (!name) return fail("An organisation name is required")
          if (product !== "firm" && product !== "institution") return fail("product must be 'firm' or 'institution'")
          const orgId = `org-client-${Object.keys(state.orgs).length + 1}`
          const org = makeOrg(orgId, name, product, { owner: ownerEmail, client: true, partner: me, setUpBy: { membershipId: `m-${orgId}-${me}`, email: me } })
          state.orgs[orgId] = org
          const jobs = org.rows.length
          log(org, "organisation_created", `Organisation "${name}" created`)
          log(org, "obligation_assigned", `${jobs} jobs opened from library 0.2-wo010`, null, "system")
          log(org, "membership_named_in_role", `Named ${me} as CA partner`)
          if (ownerEmail) log(org, "membership_named_in_role", `Named ${ownerEmail} as owner`)
          // The caller's own History (the page they are on) records it too.
          log(home(), "organisation_created", `Organisation "${name}" created`)
          if (ownerEmail) log(home(), "membership_named_in_role", `Named ${ownerEmail} as owner`)
          save(state)
          return ok({ ok: true, orgId, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "org", jobs, ownerMembershipId: ownerEmail ? `m-${orgId}-owner` : null })
        }
        case "dpdp_org_setup": {
          const org = orgOf(args?.p_org_id)
          if (!org) return fail("Not a member of this organisation")
          const setup: OrgSetupPayload = { orgId: org.id, setUpBy: org.setUpBy, ownerConfirmedAt: org.ownerConfirmedAt }
          return ok(structuredClone(setup))
        }
        case "dpdp_owner_confirm_setup": {
          const org = orgOf(args?.p_org_id)
          if (!org || viewerIn(org, me)?.kind !== "owner") return fail("Only the owner can do this")
          if (!org.setUpBy) return fail("Nothing to confirm — this organisation was set up by its owner")
          if (org.ownerConfirmedAt) return ok({ ok: true, alreadyConfirmed: true })
          const now = new Date().toISOString()
          org.ownerConfirmedAt = now
          const f = flags(org, me)
          f.firstVisitSeenAt = f.firstVisitSeenAt ?? now
          log(org, "organisation_owner_confirmed", `${me} confirmed the list their CA set up`)
          save(state)
          return ok({ ok: true, alreadyConfirmed: false })
        }
        // --- WO-DPDP-012 §7 (drizzle/0607) ---
        case "dpdp_create_ai_link": {
          const org = orgOf(args?.p_org_id) ?? home()
          const revokedPrevious = state.aiLinks > 0 ? 1 : 0
          state.aiLinks++
          const token = `mock-ai-link-${state.aiLinks}-${Math.random().toString(36).slice(2, 10)}`
          const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString()
          log(org, "ai_link_created", "Made an AI link", `Read-only, expires ${expiresAt.slice(0, 16).replace("T", " ")} UTC`)
          save(state)
          return ok({ linkId: `link-${state.aiLinks}`, token, expiresAt, revokedPrevious })
        }
        case "dpdp_ai_draft_preview": {
          if (String(args?.p_draft_id) !== MOCK_DRAFT.draftId || String(args?.p_confirm_token) !== MOCK_DRAFT.confirmToken) return fail("This draft link is not valid")
          const org = home()
          const row = draftRow()
          const now = Date.now()
          return ok({
            draftId: MOCK_DRAFT.draftId, verb: "NOTE", obligationId: row.id, job: row.what, payload: { text: "Checked with the billing team — the list is in the shared drive." },
            org: { id: org.id, name: org.name }, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 86_400_000).toISOString(), expired: false,
            confirmedAt: state.draftConfirmed ? new Date(now).toISOString() : null,
          })
        }
        case "dpdp_confirm_ai_draft": {
          if (String(args?.p_draft_id) !== MOCK_DRAFT.draftId || String(args?.p_confirm_token) !== MOCK_DRAFT.confirmToken) return fail("This draft link is not valid")
          if (state.draftConfirmed) return fail("This draft has already been confirmed")
          const row = draftRow()
          state.draftConfirmed = true
          log(home(), "ai_draft_confirmed", `drafted by AI, confirmed by ${me} -- added a note to "${row.what}"`)
          save(state)
          return ok({ ok: true, verb: "NOTE", obligationId: row.id })
        }
        // --- WO-DPDP-014 §3/§7 (drizzle/0611) ---
        case "dpdp_my_referral_code": {
          const org = orgOf(args?.p_org_id)
          if (!org || !viewerIn(org, me)) return fail("Not a member of this organisation")
          const role = shareRoleIn(org, me)
          if (!role) return fail("Only the owner, a CA partner or a CA manager can share a referral code")
          return ok({ code: MOCK_REFERRAL_CODE, role })
        }
        case "dpdp_record_share_press": {
          const org = orgOf(args?.p_org_id)
          if (!org || !viewerIn(org, me)) return fail("Not a member of this organisation")
          const role = shareRoleIn(org, me)
          if (!role) return fail("Only the owner, a CA partner or a CA manager can share a referral code")
          // No email anywhere in the event: the actor is the role label.
          log(org, "share_press", `${SHARE_ROLE_LABEL[role]} pressed Share`, role, SHARE_ROLE_LABEL[role])
          save(state)
          return ok({ ok: true, role })
        }
        default:
          return fail(`Unknown RPC ${fn}`)
      }
    },
  }
}
