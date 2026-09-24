import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { createDpdpClient, type DpdpClient } from "./lib/client"
import {
  RpcFailure, acknowledgeWelcome, answerGroup, completeOwnerFirstVisit, createClientOrg, fetchAreas, fetchHistory, fetchMyClients, fetchMyPage,
  fetchOrgSetup, flagNotMe, markDone, ownerConfirmSetup, readDraftFragment, viewerContext, type Area, type CaClient, type DraftFragment, type MyPage,
} from "./lib/api"
import type { OrgSetupPayload } from "./lib/rpc-types"
import { readLanding, recallEmail, rememberEmail, type Landing } from "./lib/landing"
import { OnePageView } from "./components/onepage/OnePageView"
import { FirstVisitWizard } from "./components/onepage/FirstVisitWizard"
import { RoleWelcome } from "./components/onepage/RoleWelcome"
import { NotMeWaiting } from "./components/onepage/NotMeWaiting"
import { Timeline, type HistoryEntry } from "./components/onepage/Timeline"
import { CaClients, type NewClient } from "./components/CaClients"
import { CaPartnerFirstVisit } from "./components/CaPartnerFirstVisit"
import { OwnerReview } from "./components/OwnerReview"
import { AiLinkButton } from "./components/AiLinkButton"
import { DraftConfirm } from "./components/DraftConfirm"
import { CheckYourEmail, ErrorScreen, LinkExpired, Loading, NoMembership, SignIn, type ResendState } from "./components/Screens"
import { BrandLine } from "./components/BrandLine"
import { shareRoleFor } from "./lib/brand"

// WO-DPDP-011 Step 2 spike: one role, the whole loop -- sign in, own jobs
// load, Mark Yes, reload shows it. Step 3 added the owner: first-visit
// wizard and History. Step 5 added everything WO-010 left: group answers,
// the CA firm view ("My clients", + Add a client / Set it up for them), the
// CA partner's three-step first visit, the owner's review when a CA set the
// org up, the AI link button and the #draft= confirm. Single page, no
// router: the phase below (plus one "page | clients" view flag) is the
// entire navigation model.
type Phase =
  | { name: "booting" }
  | { name: "signed-out"; busy: boolean; error: string | null }
  | { name: "link-expired"; email: string | null; expired: boolean; busy: boolean; error: string | null }
  | { name: "check-your-email"; email: string; resend: ResendState; error: string | null }
  | { name: "loading" }
  | { name: "app"; page: MyPage; clients: CaClient[] }
  | { name: "no-membership" }
  | { name: "error"; message: string }

const SIGNED_OUT: Phase = { name: "signed-out", busy: false, error: null }

export function App() {
  const [boot] = useState<{ landing: Landing; draft: DraftFragment | null; client: DpdpClient | Error }>(() => {
    // The URL is read before the client exists: a success hash must be left
    // for detectSessionInUrl, an error hash is consumed here (see landing.ts),
    // and a #draft= hash (the AI link's draftUrl) is consumed and cleared so
    // the confirm token never stays in the address bar.
    const landing = readLanding()
    const draft = readDraftFragment()
    try {
      return { landing, draft, client: createDpdpClient() }
    } catch (e) {
      return { landing, draft, client: e instanceof Error ? e : new Error(String(e)) }
    }
  })
  if (boot.client instanceof Error) {
    return (
      <>
        <BrandLine />
        <ErrorScreen message={boot.client.message} onRetry={() => window.location.reload()} onSignOut={() => window.location.reload()} />
      </>
    )
  }
  return <Session client={boot.client} landing={boot.landing} initialDraft={boot.draft} />
}

function Session({ client, landing, initialDraft }: { client: DpdpClient; landing: Landing; initialDraft: DraftFragment | null }) {
  const [phase, setPhase] = useState<Phase>({ name: "booting" })
  const [email, setEmail] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftFragment | null>(initialDraft)
  const [view, setView] = useState<"page" | "clients">("page")
  // Written only from the auth-event handler, never during render: whether
  // this session's first page fetch has been kicked off, so supabase-js's
  // SIGNED_IN re-emits on tab focus don't fetch the page again.
  const fetchStarted = useRef(false)
  // Which org the page shows: null = the caller's newest membership (the
  // RPC's default); set when a CA opens one of their clients.
  const orgRef = useRef<string | null>(null)

  const load = useCallback(async () => {
    // Keep the page on screen during a refetch; only a first load blanks it.
    setPhase((p) => (p.name === "app" ? p : { name: "loading" }))
    try {
      // The client list is a cross-org fact about the PERSON, read alongside
      // the page so the shell can show "My clients (N)" without a second
      // round of state. A person whose email no dpdp.identity knows gets a
      // refusal from it -- that is the same "no membership" the page call
      // reports, so it is folded into [] here and the page decides.
      const [page, clients] = await Promise.all([fetchMyPage(client, orgRef.current), fetchMyClients(client).catch(() => [] as CaClient[])])
      setPhase({ name: "app", page, clients })
    } catch (e) {
      // The contract: an error from dpdp_my_page means "no active
      // membership for this email". PGRST* codes are PostgREST itself
      // (e.g. the function isn't deployed yet) -- those are shown as real
      // errors rather than mis-labelled as a membership problem.
      const isPostgrest = e instanceof RpcFailure && !!e.code?.startsWith("PGRST")
      if (e instanceof RpcFailure && !isPostgrest) setPhase({ name: "no-membership" })
      else setPhase({ name: "error", message: e instanceof Error ? e.message : String(e) })
    }
  }, [client])

  useEffect(() => {
    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      setEmail(session?.user.email ?? null)
      if (!session) {
        fetchStarted.current = false
        if (event === "INITIAL_SESSION") {
          setPhase(landing.linkError
            ? { name: "link-expired", email: landing.emailHint ?? recallEmail(), expired: landing.linkError.expired, busy: false, error: null }
            : SIGNED_OUT)
        } else if (event === "SIGNED_OUT") {
          setPhase(SIGNED_OUT)
        }
        return
      }
      if ((event === "INITIAL_SESSION" || event === "SIGNED_IN") && !fetchStarted.current) {
        fetchStarted.current = true
        // Deferred a tick because calling back into the client from inside
        // its own auth callback can deadlock on the auth lock.
        setTimeout(() => void load(), 0)
      }
    })
    return () => subscription.unsubscribe()
  }, [client, load, landing])

  // A #draft= fragment can arrive AFTER load too: the person is already on
  // /app/ and pastes the AI's draftUrl into the same tab, which is a
  // hash-only navigation (no reload, no remount). Read and clear it exactly
  // as the boot path does, so the confirm token never stays in the address.
  useEffect(() => {
    const onHashChange = () => {
      const d = readDraftFragment()
      if (d) setDraft(d)
    }
    window.addEventListener("hashchange", onHashChange)
    return () => window.removeEventListener("hashchange", onHashChange)
  }, [])

  // emailRedirectTo is the bare origin on purpose: the address is remembered
  // in localStorage (landing.ts) rather than written into the link's URL.
  // shouldCreateUser is left at its default (true), matching the Next app's
  // own login form: membership is decided by dpdp_my_page after sign-in, not
  // by whether an auth.users row already exists.
  async function requestLink(address: string): Promise<string | null> {
    const { error } = await client.auth.signInWithOtp({ email: address, options: { emailRedirectTo: new URL("/app/", window.location.origin).href } })
    if (error) return error.message
    rememberEmail(address)
    return null
  }

  async function signIn(address: string) {
    setPhase({ name: "signed-out", busy: true, error: null })
    const err = await requestLink(address)
    setPhase(err ? { name: "signed-out", busy: false, error: err } : { name: "check-your-email", email: address, resend: "idle", error: null })
  }

  async function sendFreshLink(address: string, expired: boolean) {
    setPhase({ name: "link-expired", email: address, expired, busy: true, error: null })
    const err = await requestLink(address)
    setPhase(err ? { name: "link-expired", email: address, expired, busy: false, error: err } : { name: "check-your-email", email: address, resend: "idle", error: null })
  }

  async function resend(address: string) {
    setPhase({ name: "check-your-email", email: address, resend: "sending", error: null })
    const err = await requestLink(address)
    setPhase({ name: "check-your-email", email: address, resend: err ? "idle" : "sent", error: err })
  }

  async function signOut() {
    await client.auth.signOut()
    orgRef.current = null
    setView("page")
    setPhase(SIGNED_OUT)
  }

  // "Open" on the CA clients table: the static app's switchDpdpActiveOrg --
  // the next dpdp_my_page read is for THAT org (the caller must be a member
  // of it; the RPC refuses otherwise and the error screen says so).
  async function openOrg(orgId: string) {
    orgRef.current = orgId
    setView("page")
    await load()
  }

  let screen: ReactNode
  switch (phase.name) {
    case "booting":
    case "loading":
      screen = <Loading />
      break
    case "signed-out":
      screen = <SignIn onSubmit={signIn} busy={phase.busy} error={phase.error} />
      break
    case "link-expired":
      screen = <LinkExpired email={phase.email} expired={phase.expired} busy={phase.busy} error={phase.error} onSend={(a) => sendFreshLink(a, phase.expired)} onUseAnother={() => setPhase(SIGNED_OUT)} />
      break
    case "check-your-email":
      screen = <CheckYourEmail email={phase.email} resend={phase.resend} error={phase.error} onResend={() => resend(phase.email)} onUseAnother={() => setPhase(SIGNED_OUT)} />
      break
    case "no-membership":
      screen = <NoMembership email={email} onSignOut={signOut} />
      break
    case "error":
      screen = <ErrorScreen message={phase.message} onRetry={load} onSignOut={signOut} />
      break
    case "app":
      screen = (
        <Page
          client={client} page={phase.page} clients={phase.clients} refetch={load} email={email} onSignOut={signOut}
          view={view} onView={setView} onOpenOrg={openOrg} draft={draft} onDraftDone={() => setDraft(null)}
        />
      )
      break
  }

  // WO-DPDP-014 §2/§3: the brand line above every phase of /app/; the share
  // ask only once the page is loaded AND the viewer is a decision-maker.
  const shareRole = phase.name === "app" ? shareRoleFor(phase.page.viewer) : null
  return (
    <>
      <BrandLine share={phase.name === "app" && shareRole ? { client, orgId: phase.page.org.id, role: shareRole } : null} />
      {screen}
    </>
  )
}

function Page({
  client, page, clients, refetch, email, onSignOut, view, onView, onOpenOrg, draft, onDraftDone,
}: {
  client: DpdpClient
  page: MyPage
  clients: CaClient[]
  refetch: () => Promise<void>
  email: string | null
  onSignOut: () => void
  view: "page" | "clients"
  onView: (v: "page" | "clients") => void
  onOpenOrg: (orgId: string) => Promise<void>
  draft: DraftFragment | null
  onDraftDone: () => void
}) {
  const { org, viewer: v, rows } = page
  const viewer = viewerContext(v)
  const createClient = async (c: NewClient) => { await createClientOrg(client, c.name, c.product, c.ownerEmail) }

  // Same branching, in the same order, as src/app/dpdp/(app)/home/page.tsx
  // on main, which is the source of truth for who sees which screen first
  // -- with the two first-visit screens WO-010 never built slotted in where
  // that file's own comments said they were missing.
  let body: ReactNode
  if (viewer.kind === "owner" && !v.firstVisitSeenAt && v.membershipId) {
    // WO-DPDP-010 §4: the owner's first visit -- their own 3-step wizard, or
    // the "looks right -- confirm" review when a CA set the org up for them.
    body = <OwnerFirstVisit client={client} page={page} refetch={refetch} onSignOut={onSignOut} />
  } else if (viewer.kind === "ca" && viewer.caSub === "partner" && !v.firstVisitSeenAt && v.membershipId) {
    // WO-DPDP-010 §4: the CA partner's three steps.
    const jobCount = rows.filter((r) => r.by === v.email && !r.na).length
    body = (
      <CaPartnerFirstVisit
        orgName={org.name} jobCount={jobCount} clients={clients} refetch={refetch} onCreate={createClient}
        onAcknowledge={() => acknowledgeWelcome(client, org.id)} onNotMe={() => flagNotMe(client, org.id)}
      />
    )
  } else if (viewer.kind !== "owner" && !v.firstVisitSeenAt && v.membershipId) {
    const jobCount = rows.filter((r) => (r.by === v.email || (r.isGroup && r.viewerIsGroupMember)) && !r.na).length
    body = (
      <RoleWelcome
        orgName={org.name} roleKind={viewer.kind} caSub={viewer.caSub} jobCount={jobCount} refetch={refetch}
        onAcknowledge={() => acknowledgeWelcome(client, org.id)}
        onNotMe={() => flagNotMe(client, org.id)}
      />
    )
  } else if (viewer.kind !== "owner" && v.saidNotMeAt && rows.some((r) => r.by === v.email && !r.na)) {
    body = <NotMeWaiting orgName={org.name} />
  } else if (view === "clients") {
    body = <CaClients clients={clients} onOpen={(id) => void onOpenOrg(id)} onCreate={createClient} onBack={() => onView("page")} refetch={refetch} />
  } else {
    // PolicySection (the policy upload) is the one WO-010 section still
    // without an RPC; everything else on the page is wired.
    body = (
      <>
        <OnePageView
          orgName={org.name} rows={rows} viewer={viewer} refetch={refetch}
          onMarkYes={(id) => markDone(client, id)}
          onAnswerGroup={async (id, answer) => { await answerGroup(client, id, answer) }}
        />
        <AiLinkButton client={client} orgId={org.id} onMade={refetch} />
        {viewer.kind !== "staff" && <History client={client} page={page} />}
      </>
    )
  }

  return (
    <div className="dpdp-onepage min-h-screen">
      <div className="max-w-[1240px] mx-auto px-5 pt-3 flex justify-end items-center gap-3 flex-wrap" style={{ fontSize: 12.5, color: "var(--dpdp-ink3)" }}>
        {clients.length > 0 && view === "page" && (
          // WO-DPDP-010 §3 "CA firm view": DpdpShell's "🧾 My clients (N)"
          // entry, shown for ANY identity named CA manager/partner on at
          // least one client org, whatever their role in the current one.
          <button type="button" onClick={() => onView("clients")} className="font-semibold rounded-lg" style={{ background: "var(--dpdp-vL)", color: "var(--dpdp-v)", fontSize: 12.5, padding: "5px 10px" }}>
            🧾 My clients ({clients.length})
          </button>
        )}
        {email && <span>Signed in as <b>{email}</b></span>}
        <button type="button" onClick={onSignOut} style={{ background: "transparent", color: "var(--dpdp-ink3)", textDecoration: "underline", padding: "4px 6px" }}>Sign out</button>
      </div>
      {draft && <DraftConfirm client={client} draft={draft} onDone={refetch} onDismiss={onDraftDone} />}
      {body}
    </div>
  )
}

// The owner's first visit: home/page.tsx fetched areasForProduct() in the
// same server render; here the wizard's rows come from dpdp_areas_for_product
// once the page has loaded, and saving goes through
// dpdp_complete_owner_first_visit, after which the page is refetched -- the
// RPC stamped firstVisitSeenAt, so the refetched page no longer lands here.
// Before either, dpdp_org_setup says whether a CA set this org up: if so and
// the owner has not confirmed, the review screen replaces the wizard (the
// CA already did the wizard's work), and dpdp_owner_confirm_setup stamps
// both owner_confirmed_at and first_visit_seen_at.
function OwnerFirstVisit({ client, page, refetch, onSignOut }: { client: DpdpClient; page: MyPage; refetch: () => Promise<void>; onSignOut: () => void }) {
  const { org, viewer: v, rows } = page
  const [setup, setSetup] = useState<OrgSetupPayload | null>(null)
  const [areas, setAreas] = useState<Area[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    Promise.all([fetchOrgSetup(client, org.id), fetchAreas(client, org.product)]).then(
      ([s, a]) => { if (!cancelled) { setSetup(s); setAreas(a) } },
      (e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) },
    )
    return () => { cancelled = true }
  }, [client, org.id, org.product, attempt])

  if (error) return <ErrorScreen message={error} onRetry={() => { setError(null); setAttempt((n) => n + 1) }} onSignOut={onSignOut} />
  if (!areas || !setup) return <Loading />
  if (setup.setUpBy && !setup.ownerConfirmedAt) {
    return (
      <OwnerReview
        orgName={org.name} caEmail={setup.setUpBy.email} rows={rows} refetch={refetch}
        onConfirm={async () => { await ownerConfirmSetup(client, org.id) }}
      />
    )
  }
  return (
    <FirstVisitWizard
      orgName={org.name} rows={rows} areas={areas} ownerEmail={v.email} refetch={refetch}
      onComplete={async (assignments) => { await completeOwnerFirstVisit(client, org.id, assignments) }}
    />
  )
}

// The History timeline (owner/coordinator/GO/CA only, as on main). Re-read
// whenever `page` changes, i.e. after every successful action's refetch, so
// the entry for what was just done appears without a reload.
function History({ client, page }: { client: DpdpClient; page: MyPage }) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchHistory(client, page.org.id).then(
      (history) => {
        if (cancelled) return
        setError(null)
        setEntries(history.map((h) => ({ who: h.actorLabel, what: h.summary, at: h.occurredAt, isNew: Date.now() - h.occurredAt.getTime() < 3_600_000 })))
      },
      (e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) },
    )
    return () => { cancelled = true }
  }, [client, page])

  return (
    <div className="dpdp-onepage">
      <div className="max-w-[1240px] mx-auto px-5 pb-14">
        <div className="mb-3" style={{ fontFamily: "Sora, sans-serif", fontSize: 20, fontWeight: 700, color: "var(--dpdp-ink)" }}>🕘 History</div>
        {error ? (
          <div role="alert" className="rounded-xl px-3.5 py-2.5" style={{ background: "var(--dpdp-rL)", color: "var(--dpdp-r)", fontSize: 13, fontWeight: 600 }}>{error}</div>
        ) : entries === null ? (
          <div className="p-4" style={{ color: "var(--dpdp-ink3)" }}>Loading…</div>
        ) : (
          <Timeline entries={entries} />
        )}
      </div>
    </div>
  )
}
