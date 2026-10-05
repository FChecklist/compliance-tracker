import { useCallback, useEffect, useState, type ReactNode } from "react"
import { createDpdpClient, type DpdpClient } from "@/lib/client"
import { applyEmailAction, parentConsent, parentConsentAnswers, previewEmailAction, previewParentConsent, readFragmentToken, unsubscribe, withdrawConsent } from "@/lib/api"
import type { EmailActionPreview, ParentConsentPreview } from "@/lib/rpc-types"
import type { GroupAnswerKind } from "@/lib/dpdp-onepage/view-model"
import { answersToSend, answerWords, canSave, guardianProblem, isSimpleConsent, purposesOf, unanswered, withdrawable, type Guardian } from "@/lib/consent-page"
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
    try {
      return { client: createDpdpClient(), bootError: null }
    } catch (e) {
      return { client: null, bootError: e instanceof Error ? e.message : String(e) }
    }
  })
  // The token is state, not a one-off read: pasting a second email link into
  // the same tab is a hash-only navigation (same document, no reload), and
  // the page must judge the NEW token, not keep showing the old outcome.
  const [token, setToken] = useState<string | null>(() => readFragmentToken())
  useEffect(() => {
    const onHashChange = () => setToken(readFragmentToken())
    window.addEventListener("hashchange", onHashChange)
    return () => window.removeEventListener("hashchange", onHashChange)
  }, [])
  return { client: boot.client, token, bootError: boot.bootError }
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
  // Keyed by the token: a new token (a second email link opened in the same
  // tab, a hash-only navigation) remounts the flow, so the previous link's
  // outcome or refusal is never shown for this one.
  return <ActFlow key={token ?? ""} client={client} token={token} bootError={bootError} />
}

function ActFlow({ client, token, bootError }: { client: DpdpClient | null; token: string | null; bootError: string | null }) {
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
// src/app/dpdp/p/[token]/page.tsx. The simple case keeps its original copy and its single Yes/No
// (dpdp_parent_consent): "No is a perfectly good answer", both recorded. When the link asks about
// several items, or the person is a child, the page (drizzle/0725) shows the notice text, one
// Yes/No per item and, for a child, the parent's or guardian's name and relationship. After
// answering, the same page and the same link can withdraw a Yes with one tap: no new link.
export function ParentConsentPage() {
  const { client, token, bootError } = useTokenClient()
  const [ctx, setCtx] = useState<ParentConsentPreview | null>(() => (token ? null : { ok: false, reason: "This link is not valid or has expired" }))
  const [step, setStep] = useState<"notice" | "consent" | "done">("notice")
  const [error, setError] = useState<string | null>(bootError)
  const [pending, setPending] = useState(false)
  const [refused, setRefused] = useState<string | null>(null)
  const [answers, setAnswers] = useState<Record<string, "yes" | "no" | undefined>>({})
  const [guardian, setGuardian] = useState<Guardian>({ name: "", relation: "" })
  const [problem, setProblem] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!client || !token) return
    const p = await previewParentConsent(client, token)
    setCtx(p)
    if (p.ok && p.alreadyAnswered) setStep("done")
  }, [client, token])

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
      if (r.ok) { await load(); setStep("done") }
      else setRefused(r.reason)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPending(false)
    }
  }

  async function saveAll(c: Extract<ParentConsentPreview, { ok: true }>) {
    if (!client || !token) return
    const g = guardianProblem(!!c.principalIsChild, guardian)
    if (g) { setProblem(g); return }
    if (unanswered(purposesOf(c), answers).length > 0) { setProblem("Please answer Yes or No for each item."); return }
    setProblem(null)
    setPending(true)
    try {
      const r = await parentConsentAnswers(client, token, answersToSend(purposesOf(c), answers), c.principalIsChild ? { name: guardian.name.trim(), relation: guardian.relation as "parent" | "legal_guardian" } : null)
      if (r.ok) { await load(); setStep("done") }
      else setRefused(r.reason)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPending(false)
    }
  }

  async function withdraw(key: string) {
    if (!client || !token) return
    setPending(true)
    try {
      const r = await withdrawConsent(client, token, key)
      if (r.ok) await load()
      else setProblem(r.reason)
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

  const simple = isSimpleConsent(ctx)
  const version = ctx.notice ? `${ctx.notice.docKind} v${ctx.notice.version}` : ""
  if (step === "notice") {
    return (
      <Card icon="🔏" title="What we hold about you">
        <p style={lead}>Written plainly. {version}</p>
        {ctx.orgName && <p style={{ ...quiet, marginBottom: 18 }}>From <b>{ctx.orgName}</b>.</p>}
        {ctx.noticeText && <p style={{ ...quiet, marginBottom: 18, textAlign: "left", whiteSpace: "pre-line" }}>{ctx.noticeText}</p>}
        <button type="button" onClick={() => setStep("consent")} className="font-bold text-white" style={primaryButton}>
          Now tell us what you agree to →
        </button>
      </Card>
    )
  }
  if (step === "consent" && simple) {
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
  if (step === "consent") {
    const items = purposesOf(ctx)
    return (
      <Card icon="👪" title="Now tell us what you agree to">
        <p style={lead}>Answer each item. <b>No is a perfectly good answer</b> — either way, your answers are recorded with today&rsquo;s date.</p>
        <Busy pending={pending}>
          <div style={{ textAlign: "left", display: "grid", gap: 14, marginTop: 8 }}>
            {items.map((p) => (
              <fieldset key={p.key} style={{ border: "1.6px solid var(--dpdp-line)", borderRadius: 12, padding: 12 }}>
                <legend style={{ fontWeight: 700, padding: "0 6px" }}>{p.label}</legend>
                <div className="flex gap-2.5 items-center flex-wrap">
                  <button type="button" disabled={pending} aria-pressed={answers[p.key] === "yes"} onClick={() => setAnswers((a) => ({ ...a, [p.key]: "yes" }))} className="font-bold" style={{ ...primaryButton, background: answers[p.key] === "yes" ? "var(--dpdp-g)" : "#fff", color: answers[p.key] === "yes" ? "#fff" : "var(--dpdp-ink)", border: "1.6px solid var(--dpdp-line)" }}>Yes</button>
                  <button type="button" disabled={pending} aria-pressed={answers[p.key] === "no"} onClick={() => setAnswers((a) => ({ ...a, [p.key]: "no" }))} className="font-bold" style={{ ...primaryButton, background: answers[p.key] === "no" ? "var(--dpdp-ink)" : "#fff", color: answers[p.key] === "no" ? "#fff" : "var(--dpdp-ink)", border: "1.6px solid var(--dpdp-line)" }}>No</button>
                </div>
              </fieldset>
            ))}
            {ctx.principalIsChild && (
              <fieldset style={{ border: "1.6px solid var(--dpdp-line)", borderRadius: 12, padding: 12 }}>
                <legend style={{ fontWeight: 700, padding: "0 6px" }}>The parent or legal guardian answering for the child</legend>
                <label style={{ display: "block", marginBottom: 8 }}>Your name
                  <input value={guardian.name} onChange={(e) => setGuardian((g) => ({ ...g, name: e.target.value }))} maxLength={80} autoComplete="name" style={{ display: "block", width: "100%", padding: 8, border: "1.6px solid var(--dpdp-line)", borderRadius: 8 }} />
                </label>
                <label style={{ display: "block" }}>You are the
                  <select value={guardian.relation} onChange={(e) => setGuardian((g) => ({ ...g, relation: e.target.value as Guardian["relation"] }))} style={{ display: "block", width: "100%", padding: 8, border: "1.6px solid var(--dpdp-line)", borderRadius: 8 }}>
                    <option value="">Choose</option>
                    <option value="parent">Parent</option>
                    <option value="legal_guardian">Legal guardian</option>
                  </select>
                </label>
              </fieldset>
            )}
            {problem && <p role="alert" style={{ color: "#b3261e" }}>{problem}</p>}
            <button type="button" disabled={pending || !canSave(ctx, answers, guardian)} onClick={() => saveAll(ctx)} className="font-bold text-white" style={primaryButton}>
              Save my answers
            </button>
          </div>
        </Busy>
      </Card>
    )
  }
  const items = purposesOf(ctx)
  const canWithdraw = withdrawable(ctx)
  return (
    <Card icon="✅" title="Saved, thank you">
      <p style={lead}>Your answer is recorded with today&rsquo;s date.</p>
      {!simple && (
        <ul style={{ textAlign: "left", margin: "8px 0 12px", paddingLeft: 18 }}>
          {items.map((p) => <li key={p.key}><b>{p.label}</b>: {answerWords(p.answer)}</li>)}
        </ul>
      )}
      {simple && items[0].answer === "withdrawn" && <p style={quiet}>You withdrew your consent.</p>}
      {ctx.guardian && <p style={quiet}>Answered by {ctx.guardian.name}, {ctx.guardian.relation === "parent" ? "parent" : "legal guardian"}.</p>}
      {canWithdraw.length > 0 ? (
        <>
          <p style={quiet}>You can withdraw a Yes at any time with this same link. Nothing else will change.</p>
          <Busy pending={pending}>
            <div className="flex gap-2.5 items-center justify-center flex-wrap" style={{ marginTop: 8 }}>
              {canWithdraw.map((p) => (
                <button key={p.key} type="button" disabled={pending} onClick={() => withdraw(p.key)} className="font-bold" style={{ ...primaryButton, background: "#fff", color: "var(--dpdp-ink)", border: "1.6px solid var(--dpdp-line)" }}>
                  {simple ? "Withdraw my consent" : `Withdraw: ${p.label}`}
                </button>
              ))}
            </div>
          </Busy>
        </>
      ) : (
        <p style={quiet}>This link has done its job. If you change your mind, ask {ctx.orgName ?? "the organisation"} for a fresh one.</p>
      )}
      {problem && <p role="alert" style={{ color: "#b3261e" }}>{problem}</p>}
    </Card>
  )
}
