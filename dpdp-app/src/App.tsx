import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { createDpdpClient, type DpdpClient } from "./lib/client"
import { RpcFailure, acknowledgeWelcome, fetchMyPage, flagNotMe, markDone, viewerContext, type MyPage } from "./lib/api"
import { OnePageView } from "./components/onepage/OnePageView"
import { RoleWelcome } from "./components/onepage/RoleWelcome"
import { NotMeWaiting } from "./components/onepage/NotMeWaiting"
import { CheckYourEmail, ErrorScreen, Loading, NoMembership, SignIn } from "./components/Screens"

// WO-DPDP-011 Step 2 spike: one role, the whole loop -- sign in, own jobs
// load, Mark Yes, reload shows it. Single page, no router: the phase below
// is the entire navigation model.
type Phase =
  | { name: "booting" }
  | { name: "signed-out"; busy: boolean; error: string | null }
  | { name: "check-your-email"; email: string }
  | { name: "loading" }
  | { name: "app"; page: MyPage }
  | { name: "no-membership" }
  | { name: "error"; message: string }

export function App() {
  const [client] = useState<DpdpClient | Error>(() => {
    try {
      return createDpdpClient()
    } catch (e) {
      return e instanceof Error ? e : new Error(String(e))
    }
  })
  if (client instanceof Error) {
    return <ErrorScreen message={client.message} onRetry={() => window.location.reload()} onSignOut={() => window.location.reload()} />
  }
  return <Session client={client} />
}

function Session({ client }: { client: DpdpClient }) {
  const [phase, setPhase] = useState<Phase>({ name: "booting" })
  const phaseName = useRef<Phase["name"]>("booting")
  phaseName.current = phase.name
  const [email, setEmail] = useState<string | null>(null)

  const load = useCallback(async () => {
    // Keep the page on screen during a refetch; only a first load blanks it.
    if (phaseName.current !== "app") setPhase({ name: "loading" })
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
        if (event === "INITIAL_SESSION" || event === "SIGNED_OUT") setPhase({ name: "signed-out", busy: false, error: null })
        return
      }
      // supabase-js re-emits SIGNED_IN on tab focus; only the first one
      // (or INITIAL_SESSION on a reload) should trigger the fetch. It is
      // deferred a tick because calling back into the client from inside
      // its own auth callback can deadlock on the auth lock.
      if ((event === "INITIAL_SESSION" || event === "SIGNED_IN") && phaseName.current !== "app" && phaseName.current !== "loading") {
        setTimeout(() => void load(), 0)
      }
    })
    return () => subscription.unsubscribe()
  }, [client, load])

  async function signIn(address: string) {
    setPhase({ name: "signed-out", busy: true, error: null })
    // shouldCreateUser is left at its default (true), matching the Next app's
    // own login form: membership is decided by dpdp_my_page after sign-in,
    // not by whether an auth.users row already exists.
    const { error } = await client.auth.signInWithOtp({ email: address, options: { emailRedirectTo: window.location.origin } })
    if (error) setPhase({ name: "signed-out", busy: false, error: error.message })
    else setPhase({ name: "check-your-email", email: address })
  }

  async function signOut() {
    await client.auth.signOut()
    setPhase({ name: "signed-out", busy: false, error: null })
  }

  switch (phase.name) {
    case "booting":
    case "loading":
      return <Loading />
    case "signed-out":
      return <SignIn onSubmit={signIn} busy={phase.busy} error={phase.error} />
    case "check-your-email":
      return <CheckYourEmail email={phase.email} onUseAnother={() => setPhase({ name: "signed-out", busy: false, error: null })} />
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

  // Same branching as src/app/dpdp/(app)/home/page.tsx on main, which is
  // the source of truth for who sees which screen first.
  let body: ReactNode
  if (viewer.kind !== "owner" && !v.firstVisitSeenAt && v.membershipId) {
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
    // TODO(WO-011 Step 3): owner first visit -- FirstVisitWizard on main
    // (viewer.kind === "owner" && !firstVisitSeenAt) is not ported yet; an
    // owner on their first visit currently lands straight on the page.
    // TODO(WO-011 Step 5): onAnswerGroup (group jobs), PolicySection and the
    // Timeline history block have no RPC yet and are left unwired.
    body = (
      <OnePageView
        orgName={org.name} rows={rows} viewer={viewer} refetch={refetch}
        onMarkYes={(id) => markDone(client, id)}
        onAnswerGroup={undefined}
      />
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
