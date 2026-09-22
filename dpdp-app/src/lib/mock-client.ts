import type { AuthListener, AuthSession, DpdpClient, RpcResult } from "./client"
import type { MyPagePayload } from "./rpc-types"

// VITE_MOCK=1: an in-memory stand-in for the four public.dpdp_* RPCs so the
// whole loop (sign in -> jobs load -> Mark Yes -> reload shows it) can run
// with no Supabase credentials at all. State is mirrored into localStorage
// purely so a real browser reload still "shows it", the same way a real
// session + real DB would.

const STORAGE_KEY = "dpdp-mock-state"
const OWNER = "owner@example.test"

function daysFromNow(n: number): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + n)
  return d.toISOString()
}

function fixture(): MyPagePayload {
  return {
    org: { id: "org-mock", name: "Sharma & Associates", product: "firm" },
    viewer: { email: OWNER, kind: "owner", caSub: null, firstVisitSeenAt: daysFromNow(-30), saidNotMeAt: null, membershipId: "m-owner" },
    rows: [
      { id: "r1", part: 1, what: "Name the person who answers privacy complaints", dataSet: "Everyone", dataTypes: ["Name", "Email"], lawCodes: ["d:§8(9)", "g:"], by: OWNER, isGroup: false, due: daysFromNow(10), yes: false, na: false, dependsOnObligationId: null, sent: 0 },
      { id: "r2", part: 1, what: "Write down who looks after DPDP", dataSet: "Everyone", dataTypes: null, lawCodes: ["g:"], by: OWNER, isGroup: false, due: daysFromNow(-3), yes: true, na: false, dependsOnObligationId: null, sent: 0 },
      { id: "r3", part: 2, what: "List every place customer data is kept", dataSet: "Customer data", dataTypes: ["Name", "Phone", "Bank details"], lawCodes: ["d:§8(1)"], by: OWNER, isGroup: false, due: daysFromNow(20), yes: false, na: false, dependsOnObligationId: "r1", sent: 0 },
      { id: "r4", part: 3, what: "Put the privacy notice on the website", dataSet: "Customer data", dataTypes: ["Name", "Email"], lawCodes: ["s:R4", "d:§5"], by: "priya@example.test", isGroup: false, due: daysFromNow(-6), yes: false, na: false, dependsOnObligationId: null, sent: 0 },
      { id: "r5", part: 4, what: "Set a password on the CCTV recorder", dataSet: "CCTV", dataTypes: ["Face"], lawCodes: ["d:§8(5)"], by: null, isGroup: false, due: daysFromNow(14), yes: false, na: false, dependsOnObligationId: null, sent: 0 },
      { id: "r6", part: 7, what: "Sign the quarterly sign-off", dataSet: null, dataTypes: null, lawCodes: ["g:"], by: OWNER, isGroup: false, due: daysFromNow(40), yes: false, na: false, dependsOnObligationId: null, sent: 0 },
    ],
  }
}

type State = { signedInAs: string | null; page: MyPagePayload }

function load(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as State
  } catch {
    // private mode / blocked storage: fall through to a fresh fixture
  }
  return { signedInAs: null, page: fixture() }
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
          signedInAs: me,
          page: {
            ...state.page,
            viewer: { ...state.page.viewer, email: me },
            rows: state.page.rows.map((r) => (r.by === previous ? { ...r, by: me } : r)),
          },
        }
        save(state)
        // A real magic link is an inbox round trip; signing in on a later
        // tick keeps the app's check-your-email state reachable in mock mode.
        setTimeout(() => emit("SIGNED_IN"), 400)
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
          save(state)
          return ok({ ok: true })
        }
        case "dpdp_acknowledge_welcome":
          state.page.viewer.firstVisitSeenAt = new Date().toISOString()
          save(state)
          return ok({ ok: true })
        case "dpdp_flag_not_me":
          state.page.viewer.saidNotMeAt = new Date().toISOString()
          save(state)
          return ok({ ok: true })
        default:
          return fail(`Unknown RPC ${fn}`)
      }
    },
  }
}
