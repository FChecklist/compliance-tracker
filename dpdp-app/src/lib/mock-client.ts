import type { AuthListener, AuthSession, DpdpClient, RpcResult } from "./client"
import type { AreaAssignmentWire, AreaPayload, HistoryEntryWire, MyPagePayload } from "./rpc-types"

// VITE_MOCK=1: an in-memory stand-in for the public.dpdp_* RPCs so the
// whole loop (sign in -> owner's first-visit wizard -> jobs load -> Mark
// Yes -> History shows it -> reload shows it) can run with no Supabase
// credentials at all. State is mirrored into localStorage purely so a real
// browser reload still "shows it", the same way a real session + real DB
// would.

// v2: WO-DPDP-011 Step 3 added the owner's first visit and History. A v1
// state already had firstVisitSeenAt set, which would hide the wizard from
// anyone who had run the Step 2 mock before, so the key was bumped.
const STORAGE_KEY = "dpdp-mock-state-v2"
const OWNER = "owner@example.test"
const GO = "Grievance Officer (responsible for DPDP policy)"

// Mock-only template metadata the wire shape doesn't carry: which
// first-visit area (obligation_template.role_tag) each fixture row belongs
// to, and the two applies_when flags the RPCs read. The real firm library
// (drizzle/0602) in miniature; OWNER is excluded from the wizard exactly as
// dpdp_areas_for_product excludes it.
const TEMPLATE: Record<string, { area: string; grp?: boolean; fromArea?: boolean }> = {
  r1: { area: GO, fromArea: true },
  r2: { area: "DPDP coordinator", fromArea: true },
  r3: { area: "Customer data" },
  r4: { area: "Website firm" },
  r5: { area: "CCTV" },
  r6: { area: "OWNER" },
  r7: { area: "All staff", grp: true },
}
const NOT_AN_AREA = new Set(["OWNER", "CAMGR", "CAPARTNER"])

function daysFromNow(n: number): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + n)
  return d.toISOString()
}

// A brand-new org: nothing assigned yet except the owner's own sign-off,
// first visit not seen, so the owner lands on the wizard first.
function fixture(): MyPagePayload {
  return {
    org: { id: "org-mock", name: "Sharma & Associates", product: "firm" },
    viewer: { email: OWNER, kind: "owner", caSub: null, firstVisitSeenAt: null, saidNotMeAt: null, membershipId: "m-owner" },
    rows: [
      { id: "r1", part: 1, what: "Name the person who answers privacy complaints", dataSet: "Everyone", dataTypes: ["Name", "Email"], lawCodes: ["d:§8(9)", "g:"], by: null, isGroup: false, due: daysFromNow(10), yes: false, na: false, dependsOnObligationId: null, sent: 0 },
      { id: "r2", part: 1, what: "Write down who looks after DPDP", dataSet: "Everyone", dataTypes: null, lawCodes: ["g:"], by: null, isGroup: false, due: daysFromNow(-3), yes: false, na: false, dependsOnObligationId: null, sent: 0 },
      { id: "r3", part: 2, what: "List every place customer data is kept", dataSet: "Customer data", dataTypes: ["Name", "Phone", "Bank details"], lawCodes: ["d:§8(1)"], by: null, isGroup: false, due: daysFromNow(20), yes: false, na: false, dependsOnObligationId: "r1", sent: 0 },
      { id: "r4", part: 3, what: "Put the privacy notice on the website", dataSet: "Customer data", dataTypes: ["Name", "Email"], lawCodes: ["s:R4", "d:§5"], by: null, isGroup: false, due: daysFromNow(-6), yes: false, na: false, dependsOnObligationId: null, sent: 0 },
      { id: "r5", part: 4, what: "Set a password on the CCTV recorder", dataSet: "CCTV", dataTypes: ["Face"], lawCodes: ["d:§8(5)"], by: null, isGroup: false, due: daysFromNow(14), yes: false, na: false, dependsOnObligationId: null, sent: 0 },
      { id: "r7", part: 4, what: "Check your own laptop and phone for customer data — never forward it on personal WhatsApp", dataSet: "Everyone", dataTypes: ["Customer data on personal devices"], lawCodes: ["d:§8(5)"], by: null, isGroup: false, due: daysFromNow(12), yes: false, na: false, dependsOnObligationId: null, sent: 0 },
      { id: "r6", part: 7, what: "Sign the quarterly sign-off", dataSet: null, dataTypes: null, lawCodes: ["g:"], by: OWNER, isGroup: false, due: daysFromNow(40), yes: false, na: false, dependsOnObligationId: null, sent: 0 },
    ],
  }
}

type State = { signedInAs: string | null; page: MyPagePayload; history: HistoryEntryWire[] }

function load(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as State
  } catch {
    // private mode / blocked storage: fall through to a fresh fixture
  }
  return { signedInAs: null, page: fixture(), history: [] }
}

function save(state: State) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // same as load(): storage is a convenience here, never a requirement
  }
}

export function createMockClient(): DpdpClient {
  let state = load()
  const listeners = new Set<AuthListener>()
  const session = (): AuthSession | null => (state.signedInAs ? { user: { email: state.signedInAs } } : null)
  const emit = (event: string) => {
    const s = session()
    for (const l of listeners) l(event, s)
  }
  const ok = <T,>(data: T): RpcResult<T> => ({ data, error: null })
  const fail = (message: string): RpcResult => ({ data: null, error: { message } })
  const rowsForArea = (area: string) => state.page.rows.filter((r) => TEMPLATE[r.id]?.area === area)
  // dpdp__append_event's mirror: newest first, actor = the signed-in email.
  const log = (kind: string, summary: string, detail: string | null = null) => {
    state.history.unshift({ id: `ev-${Date.now()}-${state.history.length}`, kind, summary, detail, actorLabel: state.signedInAs ?? "system", occurredAt: new Date().toISOString() })
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
        const previous = state.page.viewer.email
        // Whoever signs in becomes the fixture's owner, so "my jobs" are theirs.
        state = {
          ...state,
          signedInAs: me,
          page: {
            ...state.page,
            viewer: { ...state.page.viewer, email: me },
            rows: state.page.rows.map((r) => (r.by === previous ? { ...r, by: me } : r)),
          },
        }
        save(state)
        // A real magic link is an inbox round trip; signing in on a later
        // tick keeps the app's check-your-email state (and its "Send me a
        // new link" button) reachable in mock mode.
        setTimeout(() => emit("SIGNED_IN"), 1500)
        return { error: null }
      },
      async signOut() {
        state = { ...state, signedInAs: null }
        save(state)
        emit("SIGNED_OUT")
        return { error: null }
      },
    },
    async rpc(fn, args) {
      if (!state.signedInAs) return fail("Not a member of this organisation")
      switch (fn) {
        case "dpdp_my_page":
          return ok(structuredClone(state.page))
        case "dpdp_mark_done": {
          const id = String(args?.p_obligation_id ?? "")
          const rows = state.page.rows
          const row = rows.find((r) => r.id === id)
          if (!row) return fail("Job not found")
          if (row.dependsOnObligationId) {
            const dep = rows.find((r) => r.id === row.dependsOnObligationId)
            if (dep && !dep.yes && !dep.na) return fail("Waiting — the step before this one isn't done yet")
          }
          row.yes = true
          log("obligation_accepted", `Said Yes to "${row.what}"`)
          save(state)
          return ok({ ok: true })
        }
        case "dpdp_acknowledge_welcome":
          state.page.viewer.firstVisitSeenAt = new Date().toISOString()
          log("membership_first_visit_acknowledged", `${state.signedInAs} saw their DPDP jobs for the first time`)
          save(state)
          return ok({ ok: true })
        case "dpdp_flag_not_me":
          state.page.viewer.saidNotMeAt = new Date().toISOString()
          log("membership_said_not_me", `${state.signedInAs} said this isn't them -- needs reassigning`)
          save(state)
          return ok({ ok: true })
        case "dpdp_areas_for_product": {
          // Same grouping as the SQL: by area, in first-appearance order,
          // group flag if any job in the area is a group job.
          const areas = new Map<string, AreaPayload>()
          for (const r of state.page.rows) {
            const t = TEMPLATE[r.id]
            if (!t || NOT_AN_AREA.has(t.area)) continue
            const a = areas.get(t.area) ?? { area: t.area, jobs: [], isGroup: false }
            a.jobs.push(r.what)
            if (t.grp) a.isGroup = true
            areas.set(t.area, a)
          }
          return ok([...areas.values()])
        }
        case "dpdp_complete_owner_first_visit": {
          if (state.page.viewer.kind !== "owner") return fail("Only the owner can do this")
          const assignments = (args?.p_assignments ?? []) as AreaAssignmentWire[]
          let assigned = 0
          let notApplicable = 0
          for (const a of assignments) {
            const rows = rowsForArea(a.area)
            if (!rows.length) continue
            if (a.na) {
              for (const r of rows) r.na = true
              log("obligation_not_my_job", `Marked "${a.area}" as not applicable`)
              notApplicable++
              continue
            }
            const emails = [...new Set(a.emails.map((e) => e.trim().toLowerCase()).filter(Boolean))]
            if (!emails.length) continue
            if (rows.some((r) => TEMPLATE[r.id]?.grp)) {
              for (const r of rows) {
                r.by = a.area
                r.isGroup = true
                r.groupTotal = emails.length
                r.groupDone = 0
                r.viewerIsGroupMember = false
                r.myGroupAnswer = null
              }
              log("membership_named_in_role", `Named ${emails.length} people to "${a.area}"`)
              assigned++
              continue
            }
            for (const r of rows) {
              r.by = emails[0]
              if (TEMPLATE[r.id]?.fromArea) r.yes = true
            }
            log("membership_named_in_role", `Named ${emails[0]} as ${a.area}`)
            assigned++
          }
          state.page.viewer.firstVisitSeenAt = new Date().toISOString()
          save(state)
          return ok({ ok: true, assigned, notApplicable })
        }
        case "dpdp_assign_person": {
          if (state.page.viewer.kind !== "owner") return fail("Only the owner can do this")
          const row = state.page.rows.find((r) => r.id === String(args?.p_obligation_id ?? ""))
          if (!row) return fail("Job not found")
          const email = String(args?.p_email ?? "").trim().toLowerCase()
          if (!email) return fail("An email address is required")
          if (row.yes) return fail("Already closed")
          if (row.na) return fail("Doesn't apply")
          row.by = email
          row.isGroup = false
          log("obligation_assigned", `Assigned "${row.what}" to ${email}`)
          save(state)
          return ok({ ok: true })
        }
        case "dpdp_mark_not_applicable": {
          const row = state.page.rows.find((r) => r.id === String(args?.p_obligation_id ?? ""))
          if (!row) return fail("Job not found")
          if (row.by !== state.signedInAs && state.page.viewer.kind !== "owner") return fail("Not your job")
          const reason = String(args?.p_reason ?? "").trim() || null
          row.na = true
          log("obligation_not_my_job", `Marked "${row.what}" as not applicable`, reason)
          save(state)
          return ok({ ok: true })
        }
        case "dpdp_org_history": {
          const limit = Math.max(1, Math.min(Number(args?.p_limit ?? 15) || 15, 50))
          return ok(structuredClone(state.history.slice(0, limit)))
        }
        default:
          return fail(`Unknown RPC ${fn}`)
      }
    },
  }
}
