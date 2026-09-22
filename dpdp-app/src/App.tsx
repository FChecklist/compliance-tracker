import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { createDpdpClient, type DpdpClient } from "./lib/client"
import { RpcFailure, acknowledgeWelcome, completeOwnerFirstVisit, fetchAreas, fetchHistory, fetchMyPage, flagNotMe, markDone, viewerContext, type Area, type MyPage } from "./lib/api"
import { readLanding, recallEmail, rememberEmail, type Landing } from "./lib/landing"
import { OnePageView } from "./components/onepage/OnePageView"
import { FirstVisitWizard } from "./components/onepage/FirstVisitWizard"
import { RoleWelcome } from "./components/onepage/RoleWelcome"
import { NotMeWaiting } from "./components/onepage/NotMeWaiting"
import { Timeline, type HistoryEntry } from "./components/onepage/Timeline"
import { CheckYourEmail, ErrorScreen, LinkExpired, Loading, NoMembership, SignIn, type ResendState } from "./components/Screens"

// WO-DPDP-011 Step 2 spike: one role, the whole loop -- sign in, own jobs
// load, Mark Yes, reload shows it. Step 3 adds the owner: first-visit wizard
// and History. Single page, no router: the phase below is the entire
// navigation model.
type Phase =
  | { name: "booting" }
  | { name: "signed-out"; busy: boolean; error: string | null }
  | { name: "link-expired"; email: string | null; expired: boolean; busy: boolean; error: string | null }
  | { name: "check-your-email"; email: string; resend: ResendState; error: string | null }
  | { name: "loading" }
  | { name: "app"; page: MyPage }
  | { name: "no-membership" }
  | { name: "error"; message: string }

const SIGNED_OUT: Phase = { name: "signed-out", busy: false, error: null }

export function App() {
  const [boot] = useState<{ landing: Landing; client: DpdpClient | Error }>(() => {
    // The URL is read before the client exists: a success hash must be left
    // for detectSessionInUrl, an error hash is consumed here (see landing.ts).
    const landing = readLanding()
    try {
      return { landing, client: createDpdpClient() }
    } catch (e) {
      return { landing, client: e instanceof Error ? e : new Error(String(e)) }
    }
  })
  if (boot.client instanceof Error) {
    return <ErrorScreen message={boot.client.message} onRetry={() => window.location.reload()} onSignOut={() => window.location.reload()} />
  }
  return <Session client={boot.client} landing={boot.landing} />
}

function Session({ client, landing }: { client: DpdpClient; landing: Landing }) {
  const [phase, setPhase] = useState<Phase>({ name: "booting" })
  const [email, setEmail] = useState<string | null>(null)
  // Written only from the auth-event handler, never during render: whether
  // this session's first page fetch has been kicked off, so supabase-js's
  // SIGNED_IN re-emits on tab focus don't fetch the page again.
  const fetchStarted = useRef(false)

  const load = useCallback(async () => {
    // Keep the page on screen during a refetch; only a first load blanks it.
    setPhase((p) => (p.name === "app" ? p : { name: "loading" }))
    try {
      const page = await fetchMyPage(client)
      setPhase({ name: "app", page })
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

  // emailRedirectTo is the bare origin on purpose: the address is remembered
  // in localStorage (landing.ts) rather than written into the link's URL.
  // shouldCreateUser is left at its default (true), matching the Next app's
  // own login form: membership is decided by dpdp_my_page after sign-in, not
  // by whether an auth.users row already exists.
  async function requestLink(address: string): Promise<string | null> {
    const { error } = await client.auth.signInWithOtp({ email: address, options: { emailRedirectTo: window.location.origin } })
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
    setPhase(SIGNED_OUT)
  }

  switch (phase.name) {
    case "booting":
    case "loading":
      return <Loading />
    case "signed-out":
      return <SignIn onSubmit={signIn} busy={phase.busy} error={phase.error} />
    case "link-expired":
      return <LinkExpired email={phase.email} expired={phase.expired} busy={phase.busy} error={phase.error} onSend={(a) => sendFreshLink(a, phase.expired)} onUseAnother={() => setPhase(SIGNED_OUT)} />
    case "check-your-email":
      return <CheckYourEmail email={phase.email} resend={phase.resend} error={phase.error} onResend={() => resend(phase.email)} onUseAnother={() => setPhase(SIGNED_OUT)} />
    case "no-membership":
      return <NoMembership email={email} onSignOut={signOut} />
    case "error":
      return <ErrorScreen message={phase.message} onRetry={load} onSignOut={signOut} />
    case "app":
      return <Page client={client} page={phase.page} refetch={load} email={email} onSignOut={signOut} />
  }
}

function Page({ client, page, refetch, email, onSignOut }: { client: DpdpClient; page: MyPage; refetch: () => Promise<void>; email: string | null; onSignOut: () => void }) {
  const { org, viewer: v, rows } = page
  const viewer = viewerContext(v)

  // Same branching, in the same order, as src/app/dpdp/(app)/home/page.tsx
  // on main, which is the source of truth for who sees which screen first.
  let body: ReactNode
  if (viewer.kind === "owner" && !v.firstVisitSeenAt && v.membershipId) {
    // WO-DPDP-010 §4: first visit, owner only for now (parent first-visit
    // screens are a separate, not-yet-built gap).
    body = <OwnerFirstVisit client={client} page={page} refetch={refetch} onSignOut={onSignOut} />
  } else if (viewer.kind !== "owner" && !v.firstVisitSeenAt && v.membershipId) {
    const jobCount = rows.filter((r) => (r.by === v.email || (r.isGroup && r.viewerIsGroupMember)) && !r.na).length
    body = (
      <RoleWelcome
        orgName={org.name} roleKind={viewer.kind} caSub={viewer.caSub} jobCount={jobCount} refetch={refetch}
        onAcknowledge={() => acknowledgeWelcome(client)}
        onNotMe={() => flagNotMe(client)}
      />
    )
  } else if (viewer.kind !== "owner" && v.saidNotMeAt && rows.some((r) => r.by === v.email && !r.na)) {
    body = <NotMeWaiting orgName={org.name} />
  } else {
    // TODO(WO-011 Step 5): onAnswerGroup (group jobs) and PolicySection
    // have no RPC yet and are left unwired.
    body = (
      <>
        <OnePageView
          orgName={org.name} rows={rows} viewer={viewer} refetch={refetch}
          onMarkYes={(id) => markDone(client, id)}
          onAnswerGroup={undefined}
        />
        {viewer.kind !== "staff" && <History client={client} page={page} />}
      </>
    )
  }

  return (
    <div className="dpdp-onepage min-h-screen">
      <div className="max-w-[1240px] mx-auto px-5 pt-3 flex justify-end items-center gap-3" style={{ fontSize: 12.5, color: "var(--dpdp-ink3)" }}>
        {email && <span>Signed in as <b>{email}</b></span>}
        <button type="button" onClick={onSignOut} style={{ background: "transparent", color: "var(--dpdp-ink3)", textDecoration: "underline", padding: "4px 6px" }}>Sign out</button>
      </div>
      {body}
    </div>
  )
}

// The owner's first visit: home/page.tsx fetched areasForProduct() in the
// same server render; here the wizard's rows come from dpdp_areas_for_product
// once the page has loaded, and saving goes through
// dpdp_complete_owner_first_visit, after which the page is refetched -- the
// RPC stamped firstVisitSeenAt, so the refetched page no longer lands here.
function OwnerFirstVisit({ client, page, refetch, onSignOut }: { client: DpdpClient; page: MyPage; refetch: () => Promise<void>; onSignOut: () => void }) {
  const { org, viewer: v, rows } = page
  const [areas, setAreas] = useState<Area[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    fetchAreas(client, org.product).then(
      (a) => { if (!cancelled) setAreas(a) },
      (e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) },
    )
    return () => { cancelled = true }
  }, [client, org.product, attempt])

  if (error) return <ErrorScreen message={error} onRetry={() => { setError(null); setAttempt((n) => n + 1) }} onSignOut={onSignOut} />
  if (!areas) return <Loading />
  return (
    <FirstVisitWizard
      orgName={org.name} rows={rows} areas={areas} ownerEmail={v.email} refetch={refetch}
      onComplete={async (assignments) => { await completeOwnerFirstVisit(client, org.id, assignments) }}
    />
  )
}

// The History timeline (owner/coordinator/GO only, as on main). Re-read
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
