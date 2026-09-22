import { useEffect, useState, type ReactNode } from "react"
import { createDpdpClient, type DpdpClient } from "@/lib/client"
import { applyEmailAction, parentConsent, previewEmailAction, previewParentConsent, readFragmentToken, unsubscribe } from "@/lib/api"
import type { EmailActionPreview, ParentConsentPreview } from "@/lib/rpc-types"
import type { GroupAnswerKind } from "@/lib/dpdp-onepage/view-model"
import { Card } from "./Screens"

// WO-DPDP-011 Step 5: the three pages a person reaches from an EMAIL, with
// no account and no session -- the opaque token in the URL fragment is the
// credential (drizzle/0606 for /act/ and /unsubscribe/, 0609 for /p/). Each
// page is its own Vite entry (act/, unsubscribe/, p/ -- see
// src/lib/public-surface.mjs) so /app/'s bundle, which holds a session,
// never loads here. The one rule every page keeps: opening the link
// changes nothing; only the button does.

const GROUP_ANSWER_LABEL: Record<GroupAnswerKind, string> = { done: "Done", never_had_any: "Doesn't apply to me", cannot: "I can't" }

const primaryButton = { background: "var(--dpdp-v)", fontSize: 15, padding: "13px 22px", borderRadius: 14 } as const
const lead = { fontSize: 15, color: "var(--dpdp-ink2)", margin: "0 auto 18px", maxWidth: "44ch" } as const
const quiet = { fontSize: 13, color: "var(--dpdp-ink3)", margin: "0 auto", maxWidth: "44ch" } as const

function useTokenClient(): { client: DpdpClient | null; token: string | null; bootError: string | null } {
  const [boot] = useState(() => {
    const token = readFragmentToken()
    try {
      return { client: createDpdpClient(), token, bootError: null }
    } catch (e) {
      return { client: null, token, bootError: e instanceof Error ? e.message : String(e) }
    }
  })
  return boot
}

function Refused({ reason }: { reason: string }) {
  return (
    <Card icon="🙈" title="This link can't be used">
      <p role="alert" style={lead}>{reason}</p>
      <p style={quiet}>Nothing has changed. If you need a fresh link, ask the person who sent you this one.</p>
    </Card>
  )
}

function Checking() {
  return (
    <Card icon="⏳" title="Checking your link">
      <p style={{ fontSize: 15, color: "var(--dpdp-ink2)", margin: 0 }}>One moment.</p>
    </Card>
  )
}

function Problem({ message }: { message: string }) {
  return (
    <Card icon="⚠️" title="Something went wrong">
      <p role="alert" style={{ fontSize: 14, color: "var(--dpdp-r)", margin: "0 auto 18px", maxWidth: "48ch", fontWeight: 600 }}>{message}</p>
      <p style={quiet}>Nothing has changed. Try the link again in a moment.</p>
    </Card>
  )
}

function Busy({ pending, children }: { pending: boolean; children: ReactNode }) {
  return <div style={pending ? { opacity: 0.6, pointerEvents: "none" } : undefined}>{children}</div>
}

// ---------------------------------------------------------------- /act/
// The Monday email's one-click button. Open: dpdp_preview_email_action
// (zero writes) says what the button would record. Press: dpdp_apply_email_
// action spends the token and writes exactly what the in-app button does.
export function ActPage() {
  const { client, token, bootError } = useTokenClient()
  // No token in the fragment is decided before any effect runs: the page
  // opens straight on the refusal, nothing is fetched.
  const [preview, setPreview] = useState<EmailActionPreview | null>(() => (token ? null : { ok: false, reason: "This link is not valid." }))
  const [error, setError] = useState<string | null>(bootError)
  const [pending, setPending] = useState(false)
  const [outcome, setOutcome] = useState<{ ok: true; what: string | null; answer: GroupAnswerKind } | { ok: false; reason: string } | null>(null)

  useEffect(() => {
    if (!client || !token) return
    let cancelled = false
    previewEmailAction(client, token).then(
      (p) => { if (!cancelled) setPreview(p) },
      (e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) },
    )
    return () => { cancelled = true }
  }, [client, token])

  async function press(answer: GroupAnswerKind) {
    if (!client || !token) return
    setPending(true)
    try {
      setOutcome(await applyEmailAction(client, token, answer))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPending(false)
    }
  }

  if (error) return <Problem message={error} />
  if (outcome) {
    if (!outcome.ok) return <Refused reason={outcome.reason} />
    return (
      <Card icon="✅" title="Recorded, thank you">
        <p style={lead}>&ldquo;{GROUP_ANSWER_LABEL[outcome.answer]}&rdquo; is now recorded for <b>{outcome.what ?? "this job"}</b>. You can close this page.</p>
      </Card>
    )
  }
  if (!preview) return <Checking />
  if (!preview.ok) return <Refused reason={preview.reason} />
  const label = GROUP_ANSWER_LABEL[preview.action]
  if (preview.alreadyDone) {
    return (
      <Card icon="✅" title="Already done">
        <p style={lead}><b>{preview.what ?? "This job"}</b> is already marked done. There is nothing to press.</p>
      </Card>
    )
  }
  return (
    <Card icon="✉️" title={preview.orgName ?? "VERIDIAN DPDP"}>
      <p style={lead}>
        Pressing the button below records <b>&ldquo;{label}&rdquo;</b> for <b>{preview.what ?? "this job"}</b>{preview.isGroup ? " — your own answer, for you alone" : ""}.
      </p>
      <p style={{ ...quiet, marginBottom: 18 }}>Opening this page has changed nothing.</p>
      <Busy pending={pending}>
        <button type="button" disabled={pending} onClick={() => press(preview.action)} className="font-bold text-white" style={primaryButton}>
          {pending ? "Recording…" : `Yes — record "${label}"`}
        </button>
      </Busy>
    </Card>
  )
}

// -------------------------------------------------------- /unsubscribe/
// RFC 8058 one-click aside, the page a person lands on from the email's
// "stop these" link. dpdp_unsubscribe drops them to statutory notices only
// -- never to nothing (WO-011 §2.5) -- and only when the button is pressed.
export function UnsubscribePage() {
  const { client, token, bootError } = useTokenClient()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(bootError)
  const [outcome, setOutcome] = useState<{ ok: true; email: string } | { ok: false; reason: string } | null>(null)

  async function press() {
    if (!client || !token) return
    setPending(true)
    try {
      setOutcome(await unsubscribe(client, token))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPending(false)
    }
  }

  if (error) return <Problem message={error} />
  if (!token) return <Refused reason="This link is not valid." />
  if (outcome) {
    if (!outcome.ok) return <Refused reason={outcome.reason} />
    return (
      <Card icon="🔕" title="Stopped">
        <p style={lead}>The weekly email to <b>{outcome.email}</b> has been stopped. Statutory notices — the ones the law requires — will still come.</p>
      </Card>
    )
  }
  return (
    <Card icon="🔕" title="Stop the weekly email?">
      <p style={lead}>Press the button and we&rsquo;ll stop the Monday email to this address. Statutory notices — the ones the law requires — will still come.</p>
      <p style={{ ...quiet, marginBottom: 18 }}>Opening this page has changed nothing.</p>
      <Busy pending={pending}>
        <button type="button" disabled={pending} onClick={press} className="font-bold text-white" style={primaryButton}>
          {pending ? "Stopping…" : "Stop the weekly email"}
        </button>
      </Busy>
    </Card>
  )
}

// -------------------------------------------------------------------- /p/
// The parent / data-principal consent page: the port of
// src/app/dpdp/p/[token]/page.tsx. Copy is that page's, verbatim, for the
// notice step and the saved step; the answer step is WO-011 §4's "Yes/No;
// No is a valid answer" -- two buttons, both recorded, in place of the
// Next.js page's per-purpose ticks (dpdp_parent_consent takes one answer).
export function ParentConsentPage() {
  const { client, token, bootError } = useTokenClient()
  const [ctx, setCtx] = useState<ParentConsentPreview | null>(() => (token ? null : { ok: false, reason: "This link is not valid or has expired" }))
  const [step, setStep] = useState<"notice" | "consent" | "done">("notice")
  const [error, setError] = useState<string | null>(bootError)
  const [pending, setPending] = useState(false)
  const [refused, setRefused] = useState<string | null>(null)

  useEffect(() => {
    if (!client || !token) return
    let cancelled = false
    previewParentConsent(client, token).then(
      (p) => {
        if (cancelled) return
        setCtx(p)
        if (p.ok && p.alreadyAnswered) setStep("done")
      },
      (e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) },
    )
    return () => { cancelled = true }
  }, [client, token])

  async function answer(a: "yes" | "no") {
    if (!client || !token) return
    setPending(true)
    try {
      const r = await parentConsent(client, token, a)
      if (r.ok) setStep("done")
      else setRefused(r.reason)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPending(false)
    }
  }

  if (error) return <Problem message={error} />
  if (!ctx) return <Checking />
  if (!ctx.ok) return <Refused reason={ctx.reason} />
  if (refused) return <Refused reason={refused} />

  const version = ctx.notice ? `${ctx.notice.docKind} v${ctx.notice.version}` : ""
  if (step === "notice") {
    return (
      <Card icon="🔏" title="What we hold about you">
        <p style={lead}>Written plainly. {version}</p>
        {ctx.orgName && <p style={{ ...quiet, marginBottom: 18 }}>From <b>{ctx.orgName}</b>.</p>}
        <button type="button" onClick={() => setStep("consent")} className="font-bold text-white" style={primaryButton}>
          Now tell us what you agree to →
        </button>
      </Card>
    )
  }
  if (step === "consent") {
    return (
      <Card icon="👪" title="Now tell us what you agree to">
        <p style={lead}>Press Yes or No. <b>No is a perfectly good answer</b> — either way, your answer is recorded with today&rsquo;s date.</p>
        <Busy pending={pending}>
          <div className="flex gap-2.5 items-center justify-center flex-wrap">
            <button type="button" disabled={pending} onClick={() => answer("yes")} className="font-bold text-white" style={{ ...primaryButton, background: "var(--dpdp-g)" }}>
              Yes, I agree
            </button>
            <button type="button" disabled={pending} onClick={() => answer("no")} className="font-bold" style={{ ...primaryButton, background: "#fff", color: "var(--dpdp-ink)", border: "1.6px solid var(--dpdp-line)" }}>
              No, I do not agree
            </button>
          </div>
        </Busy>
      </Card>
    )
  }
  return (
    <Card icon="✅" title="Saved, thank you">
      <p style={lead}>Your answer is recorded with today&rsquo;s date.</p>
      <p style={quiet}>This link has done its job. If you change your mind, ask {ctx.orgName ?? "the organisation"} for a fresh one.</p>
    </Card>
  )
}
