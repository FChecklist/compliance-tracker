import type { AuthListener, AuthSession, DpdpClient, RpcResult } from "./client"
import type { GroupAnswerKind } from "@/lib/dpdp-onepage/view-model"
import type { AreaAssignmentWire, AreaPayload, CaClientWire, HistoryEntryWire, MyPagePayload, OrgSetupPayload } from "./rpc-types"

// VITE_MOCK=1: an in-memory stand-in for the public.dpdp_* RPCs so the
// whole loop (sign in -> owner's first-visit wizard -> jobs load -> Mark
// Yes -> History shows it -> reload shows it) can run with no Supabase
// credentials at all. State is mirrored into localStorage purely so a real
// browser reload still "shows it", the same way a real session + real DB
// would.

// v3: WO-DPDP-011 Step 5 added group answers, the CA firm view, the
// owner-review-when-the-CA-set-it-up first visit, the token pages and the
// AI link. Older states lack those fields, so the key was bumped again.
const STORAGE_KEY = "dpdp-mock-state-v3"
const OWNER = "owner@example.test"
const GO = "Grievance Officer (responsible for DPDP policy)"

// Two more people the mock knows by address, so every first-visit screen
// is reachable without a database: sign in as PARTNER to be a CA partner
// (the CA firm view, the three-step first visit), as CLIENT_OWNER to be an
// owner whose org that CA set up (the "looks right -- confirm" review).
// Anyone else is the org's own owner, as before.
export const MOCK_PARTNER = "partner@example.test"
export const MOCK_CLIENT_OWNER = "client-owner@example.test"

// The fragment tokens the token pages accept in mock mode.
export const MOCK_TOKENS = { done: "mock-done", cannot: "mock-cannot", unsubscribe: "mock-unsub", parent: "mock-parent" } as const
export const MOCK_DRAFT = { draftId: "mock-draft", confirmToken: "mock-confirm" } as const

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

function fixtureClients(): CaClientWire[] {
  return [{ org: { id: "org-mehta", name: "Mehta Traders", product: "firm" }, caSub: "partner", done: 4, total: 31, whereItIs: "In progress", dataLocations: 0, ownerConfirmedAt: daysFromNow(-20), setUpByMe: false }]
}

type State = {
  signedInAs: string | null
  page: MyPagePayload
  history: HistoryEntryWire[]
  clients: CaClientWire[]
  setup: OrgSetupPayload
  groupAnswers: Record<string, Record<string, GroupAnswerKind>>
  spentTokens: string[]
  consentAnswered: boolean
  unsubscribed: boolean
  draftConfirmed: boolean
  aiLinks: number
}

function fresh(): State {
  return {
    signedInAs: null, page: fixture(), history: [], clients: [], setup: { orgId: "org-mock", setUpBy: null, ownerConfirmedAt: null },
    groupAnswers: {}, spentTokens: [], consentAnswered: false, unsubscribed: false, draftConfirmed: false, aiLinks: 0,
  }
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
  const log = (kind: string, summary: string, detail: string | null = null, actor: string | null = state.signedInAs) => {
    state.history.unshift({ id: `ev-${Date.now()}-${state.history.length}`, kind, summary, detail, actorLabel: actor ?? "system", occurredAt: new Date().toISOString() })
  }
  const emailActionRow = () => state.page.rows.find((r) => r.id === "r6")!

  // The token functions (drizzle/0606 + 0609's parent consent) need no
  // session: the token is the credential, so they are answered before the
  // signed-in gate below, with { ok:false, reason } rather than an error.
  function tokenRpc(fn: string, args?: Record<string, unknown>): RpcResult | null {
    const token = String(args?.p_token ?? "")
    switch (fn) {
      case "dpdp_preview_email_action": {
        const action = token === MOCK_TOKENS.done ? "done" : token === MOCK_TOKENS.cannot ? "cannot" : null
        if (!action) return ok({ ok: false, reason: "This link is not valid." })
        if (state.spentTokens.includes(token)) return ok({ ok: false, reason: "This link has already been used. Nothing has changed." })
        const row = emailActionRow()
        return ok({ ok: true, action, what: row.what, orgName: state.page.org.name, isGroup: false, alreadyDone: row.yes })
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
          log("obligation_accepted", `Said Yes to "${row.what}"`, null, OWNER)
        } else {
          log("obligation_stuck", "Said they are stuck", `Pressed "I can't" on the Monday email for "${row.what}"`, OWNER)
        }
        save(state)
        return ok({ ok: true, obligationId: row.id, answer: action, what: row.what })
      }
      case "dpdp_unsubscribe": {
        if (token !== MOCK_TOKENS.unsubscribe) return ok({ ok: false, reason: "This link is not valid." })
        state.unsubscribed = true
        log("membership_email_unsubscribed", `${OWNER} stopped the weekly email (statutory notices continue)`, null, OWNER)
        save(state)
        return ok({ ok: true, email: OWNER })
      }
      case "dpdp_parent_consent_preview": {
        if (token !== MOCK_TOKENS.parent) return ok({ ok: false, reason: "This link is not valid or has expired" })
        return ok({ ok: true, orgName: state.page.org.name, notice: { docKind: "privacy", version: "1.0", languages: ["en"] }, openedAt: new Date().toISOString(), actedAt: state.consentAnswered ? new Date().toISOString() : null, alreadyAnswered: state.consentAnswered })
      }
      case "dpdp_parent_consent": {
        const answer = String(args?.p_answer ?? "")
        if (answer !== "yes" && answer !== "no") return ok({ ok: false, reason: "That is not an answer this link can record." })
        if (token !== MOCK_TOKENS.parent) return ok({ ok: false, reason: "This link is not valid or has expired" })
        if (state.consentAnswered) return ok({ ok: false, reason: "This link has already been used. Nothing has changed." })
        state.consentAnswered = true
        log("consent_recorded", "Recorded 1 answer(s)", null, "A person on a link")
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
        const previous = state.page.viewer.email
        // Whoever signs in becomes the fixture's viewer: the org's owner,
        // unless they are one of the two named personas above.
        const isPartner = me === MOCK_PARTNER
        state = {
          ...state,
          signedInAs: me,
          page: {
            ...state.page,
            viewer: { ...state.page.viewer, email: me, kind: isPartner ? "ca" : "owner", caSub: isPartner ? "partner" : null },
            rows: state.page.rows.map((r) => (r.by === previous ? { ...r, by: me } : r)),
          },
          clients: isPartner ? fixtureClients() : state.clients,
          setup: me === MOCK_CLIENT_OWNER
            ? { orgId: "org-mock", setUpBy: { membershipId: "m-ca", email: MOCK_PARTNER }, ownerConfirmedAt: null }
            : { orgId: "org-mock", setUpBy: null, ownerConfirmedAt: null },
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
      const viaToken = tokenRpc(fn, args)
      if (viaToken) return viaToken
      if (!state.signedInAs) return fail("Not a member of this organisation")
      const me = state.signedInAs
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
          log("membership_first_visit_acknowledged", `${me} saw their DPDP jobs for the first time`)
          save(state)
          return ok({ ok: true })
        case "dpdp_flag_not_me":
          state.page.viewer.saidNotMeAt = new Date().toISOString()
          log("membership_said_not_me", `${me} said this isn't them -- needs reassigning`)
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
                // The real RPC knows group membership from staff_group_member;
                // here, the signed-in address being on the list is that fact.
                r.viewerIsGroupMember = emails.includes(me)
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
          if (row.by !== me && state.page.viewer.kind !== "owner") return fail("Not your job")
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
        // --- WO-DPDP-011 Step 5 (drizzle/0609) ---
        case "dpdp_answer_group": {
          const row = state.page.rows.find((r) => r.id === String(args?.p_obligation_id ?? ""))
          if (!row) return fail("Job not found")
          const answer = String(args?.p_answer ?? "") as GroupAnswerKind
          if (!(answer in GROUP_ANSWER_LABEL)) return fail("That is not an answer this job can record.")
          if (!row.isGroup) return fail("This job isn't assigned to a group")
          if (row.dependsOnObligationId) {
            const dep = state.page.rows.find((r) => r.id === row.dependsOnObligationId)
            if (dep && !dep.yes && !dep.na) return fail("Waiting — the step before this one isn't done yet")
          }
          if (!row.viewerIsGroupMember) return fail("You aren't a member of the group this job is assigned to")
          const answers = (state.groupAnswers[row.id] ??= {})
          answers[me] = answer
          const answered = Object.keys(answers).length
          const total = row.groupTotal ?? 1
          const closed = answered >= total
          row.groupDone = answered
          row.myGroupAnswer = answer
          if (closed) row.yes = true
          log(answer === "cannot" ? "task_answer_refused" : "task_answered", `${me} answered "${GROUP_ANSWER_LABEL[answer]}" for "${row.what}" (${answered} of ${total})`)
          save(state)
          return ok({ ok: true, answered, total, closed })
        }
        case "dpdp_my_clients":
          return ok(structuredClone(state.clients))
        case "dpdp_create_client_org": {
          const name = String(args?.p_name ?? "").trim()
          const product = String(args?.p_product ?? "")
          const ownerEmail = String(args?.p_owner_email ?? "").trim().toLowerCase()
          if (!name) return fail("An organisation name is required")
          if (product !== "firm" && product !== "institution") return fail("product must be 'firm' or 'institution'")
          const orgId = `org-client-${state.clients.length + 1}`
          const jobs = product === "firm" ? 31 : 28
          state.clients.push({ org: { id: orgId, name, product }, caSub: "partner", done: 0, total: jobs, whereItIs: ownerEmail ? "Waiting for the owner to confirm" : "Not started", dataLocations: 0, ownerConfirmedAt: null, setUpByMe: true })
          log("organisation_created", `Organisation "${name}" created`)
          log("obligation_assigned", `${jobs} jobs opened from library 0.2-wo010`, null, "system")
          log("membership_named_in_role", `Named ${me} as CA partner`)
          if (ownerEmail) log("membership_named_in_role", `Named ${ownerEmail} as owner`)
          save(state)
          return ok({ ok: true, orgId, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "org", jobs, ownerMembershipId: ownerEmail ? `m-${orgId}-owner` : null })
        }
        case "dpdp_org_setup":
          return ok(structuredClone(state.setup))
        case "dpdp_owner_confirm_setup": {
          if (state.page.viewer.kind !== "owner") return fail("Only the owner can do this")
          if (!state.setup.setUpBy) return fail("Nothing to confirm — this organisation was set up by its owner")
          if (state.setup.ownerConfirmedAt) return ok({ ok: true, alreadyConfirmed: true })
          const now = new Date().toISOString()
          state.setup.ownerConfirmedAt = now
          state.page.viewer.firstVisitSeenAt = state.page.viewer.firstVisitSeenAt ?? now
          log("organisation_owner_confirmed", `${me} confirmed the list their CA set up`)
          save(state)
          return ok({ ok: true, alreadyConfirmed: false })
        }
        // --- WO-DPDP-012 §7 (drizzle/0607) ---
        case "dpdp_create_ai_link": {
          const revokedPrevious = state.aiLinks > 0 ? 1 : 0
          state.aiLinks++
          const token = `mock-ai-link-${state.aiLinks}-${Math.random().toString(36).slice(2, 10)}`
          const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString()
          log("ai_link_created", "Made an AI link", `Read-only, expires ${expiresAt.slice(0, 16).replace("T", " ")} UTC`)
          save(state)
          return ok({ linkId: `link-${state.aiLinks}`, token, expiresAt, revokedPrevious })
        }
        case "dpdp_ai_draft_preview": {
          if (String(args?.p_draft_id) !== MOCK_DRAFT.draftId || String(args?.p_confirm_token) !== MOCK_DRAFT.confirmToken) return fail("This draft link is not valid")
          const row = state.page.rows.find((r) => r.id === "r3")!
          const now = Date.now()
          return ok({
            draftId: MOCK_DRAFT.draftId, verb: "NOTE", obligationId: row.id, job: row.what, payload: { text: "Checked with the billing team — the list is in the shared drive." },
            org: { id: state.page.org.id, name: state.page.org.name }, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 86_400_000).toISOString(), expired: false,
            confirmedAt: state.draftConfirmed ? new Date(now).toISOString() : null,
          })
        }
        case "dpdp_confirm_ai_draft": {
          if (String(args?.p_draft_id) !== MOCK_DRAFT.draftId || String(args?.p_confirm_token) !== MOCK_DRAFT.confirmToken) return fail("This draft link is not valid")
          if (state.draftConfirmed) return fail("This draft has already been confirmed")
          const row = state.page.rows.find((r) => r.id === "r3")!
          state.draftConfirmed = true
          log("ai_draft_confirmed", `drafted by AI, confirmed by ${me} -- added a note to "${row.what}"`)
          save(state)
          return ok({ ok: true, verb: "NOTE", obligationId: row.id })
        }
        default:
          return fail(`Unknown RPC ${fn}`)
      }
    },
  }
}
