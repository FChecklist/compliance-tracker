import { useState, type FormEvent, type ReactNode } from "react"
import "./onepage/dpdp-onepage-tokens.css"

export function Card({ icon, title, children }: { icon: string; title: string; children: ReactNode }) {
  return (
    <div className="dpdp-onepage min-h-screen">
      <div className="max-w-[560px] mx-auto px-5 py-14">
        <div className="rounded-[22px] border p-8 text-center" style={{ background: "var(--dpdp-card)", borderColor: "var(--dpdp-line)" }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>{icon}</div>
          <h1 style={{ fontFamily: "Sora, sans-serif", fontSize: 24, fontWeight: 700, margin: "0 0 8px", color: "var(--dpdp-ink)" }}>{title}</h1>
          {children}
        </div>
      </div>
    </div>
  )
}

const linkButton = { background: "transparent", color: "var(--dpdp-ink3)", fontSize: 13.5, padding: "11px 10px", textDecoration: "underline" } as const
const primaryButton = { background: "var(--dpdp-v)", fontSize: 15, padding: "13px 22px", borderRadius: 14 } as const
const lead = { fontSize: 15, color: "var(--dpdp-ink2)", margin: "0 auto 18px", maxWidth: "40ch" } as const

function InlineError({ message }: { message: string | null }) {
  if (!message) return null
  return <p role="alert" style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--dpdp-r)" }}>{message}</p>
}

// One email field + one button. The sign-in screen and the expired-link
// screen (when the address isn't known on this device) are this same form
// with different words around it.
function EmailForm({ buttonLabel, busy, error, onSubmit }: { buttonLabel: string; busy: boolean; error: string | null; onSubmit: (email: string) => void }) {
  const [email, setEmail] = useState("")
  function submit(e: FormEvent) {
    e.preventDefault()
    onSubmit(email.trim())
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-3 items-stretch text-left">
      <label htmlFor="email" style={{ fontSize: 13, fontWeight: 600, color: "var(--dpdp-ink2)" }}>Your email</label>
      <input
        id="email" name="email" type="email" required autoComplete="email" autoFocus
        value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy}
        className="rounded-xl border px-3.5 py-3"
        style={{ borderColor: "var(--dpdp-line)", fontSize: 15, color: "var(--dpdp-ink)", background: "#fff" }}
      />
      <button type="submit" disabled={busy} className="font-bold text-white" style={{ ...primaryButton, opacity: busy ? 0.6 : 1 }}>
        {busy ? "Sending…" : buttonLabel}
      </button>
      <InlineError message={error} />
    </form>
  )
}

/**
 * The first screen: sign in, or start free (the e-mail address is all it takes; membership is decided after sign-in). Every line is a fact the product
 * states elsewhere (data/veridian-facts.yaml, the pricing page): nothing here is a promise that is not already published.
 */
export const SIGNIN_BENEFITS: ReadonlyArray<{ icon: string; text: string }> = [
  { icon: "📋", text: "Turns the DPDP Act into a list of jobs" },
  { icon: "👤", text: "Gives each job to the right person" },
  { icon: "✉️", text: "One email a week. No passwords" },
  { icon: "🕓", text: "Every answer is dated and cannot be edited" },
  { icon: "⚖️", text: "Each job is linked to its legal source" },
  { icon: "📁", text: "Your documents stay with you" },
  { icon: "🤖", text: "Let your own AI help with the jobs" },
]

export function SignIn({ onSubmit, busy, error }: { onSubmit: (email: string) => void; busy: boolean; error: string | null }) {
  return (
    <div className="dpdp-onepage min-h-screen">
      <div className="max-w-[780px] mx-auto px-4 py-8 sm:py-14">
        <section aria-labelledby="signin-title" className="rounded-[22px] border p-5 sm:p-9" style={{ background: "var(--dpdp-card)", borderColor: "var(--dpdp-line)" }}>
          <div className="flex items-start justify-between gap-3 mb-4">
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "var(--dpdp-v)" }}>Free to start. Pay only when you agree a price.</p>
            <BrandMark />
          </div>
          <p style={{ display: "inline-block", margin: "0 0 12px", padding: "5px 12px", borderRadius: 999, background: "var(--dpdp-line2)", color: "var(--dpdp-ink2)", fontSize: 13, fontWeight: 600 }}>For the business owner or compliance lead</p>
          <h1 id="signin-title" style={{ fontFamily: "Sora, sans-serif", fontSize: 30, lineHeight: 1.15, fontWeight: 700, margin: "0 0 18px", color: "var(--dpdp-ink)" }}>Sign in or start free</h1>
          <ul className="grid gap-x-6 gap-y-2.5 mb-6 sm:grid-cols-2" style={{ listStyle: "none", padding: 0, margin: "0 0 24px" }}>
            {SIGNIN_BENEFITS.map((b) => (
              <li key={b.text} className="flex gap-2.5 items-start" style={{ fontSize: 15, color: "var(--dpdp-ink2)" }}>
                <span aria-hidden="true" style={{ fontSize: 18, lineHeight: "22px" }}>{b.icon}</span>
                <span>{b.text}</span>
              </li>
            ))}
          </ul>
          <div className="max-w-[460px]">
            <EmailForm buttonLabel="Email me a sign-in link" busy={busy} error={error} onSubmit={onSubmit} />
            <p style={{ fontSize: 13.5, color: "var(--dpdp-ink3)", margin: "12px 0 0" }}>No password. We use your email to sign you in and to send your invoices.</p>
          </div>
          <p style={{ fontSize: 12.5, color: "var(--dpdp-ink3)", margin: "20px 0 0", paddingTop: 14, borderTop: "1px solid var(--dpdp-line)" }}>Built for India&rsquo;s DPDP Act. We do not certify compliance.</p>
        </section>
      </div>
    </div>
  )
}

export type ResendState = "idle" | "sending" | "sent"

/** The Veridian DPDP mark, top right of the sign-in pop-up (the same wordmark as the site and the e-mails). */
export function BrandMark() {
  return (
    <span aria-label="Veridian DPDP" style={{ fontFamily: "Sora, sans-serif", fontWeight: 700, fontSize: 15, letterSpacing: "0.02em", color: "var(--dpdp-ink)", whiteSpace: "nowrap" }}>
      VERIDIAN <span style={{ color: "var(--dpdp-v)" }}>DPDP</span>
    </span>
  )
}

export function CheckYourEmail({
  email, resend, error, onResend, onUseAnother, onVerify,
}: { email: string; resend: ResendState; error: string | null; onResend: () => void; onUseAnother: () => void; onVerify?: (code: string) => Promise<string | null> }) {
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [codeError, setCodeError] = useState<string | null>(null)
  async function submit(e: FormEvent) {
    e.preventDefault()
    const clean = code.replace(/\s/g, "")
    if (!/^\d{6,8}$/.test(clean)) { setCodeError("Type the passcode from the email."); return }
    if (!onVerify) return
    setBusy(true)
    setCodeError(null)
    const err = await onVerify(clean)
    if (err) { setCodeError(err); setBusy(false) }
  }
  return (
    <div className="dpdp-onepage min-h-screen">
      <div className="max-w-[480px] mx-auto px-4 py-8 sm:py-14">
        <div role="dialog" aria-labelledby="check-title" className="rounded-[22px] border p-5 sm:p-8" style={{ background: "var(--dpdp-card)", borderColor: "var(--dpdp-line)" }}>
          <div className="flex items-center justify-between gap-3 mb-5">
            <p style={{ margin: 0, fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--dpdp-ink3)", whiteSpace: "nowrap" }}>Check your inbox</p>
            <div className="flex items-center gap-3">
              <BrandMark />
              <button type="button" onClick={onUseAnother} aria-label="Close and use a different email" style={{ background: "transparent", color: "var(--dpdp-ink3)", fontSize: 24, lineHeight: 1, padding: "4px 8px", minWidth: 44, minHeight: 44 }}>×</button>
            </div>
          </div>
          <h1 id="check-title" style={{ fontFamily: "Sora, sans-serif", fontSize: 26, fontWeight: 700, margin: "0 0 10px", color: "var(--dpdp-ink)" }}>Check your email</h1>
          <p style={{ fontSize: 15, color: "var(--dpdp-ink2)", margin: "0 0 20px" }}>
            We sent an email to <b>{email}</b>. Tap a button in it, or type the passcode here.
          </p>
          <form onSubmit={submit} className="flex flex-col gap-3 items-stretch">
            <label htmlFor="passcode" style={{ fontSize: 13, fontWeight: 600, color: "var(--dpdp-ink2)" }}>Passcode</label>
            <input
              id="passcode" name="passcode" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={10}
              value={code} onChange={(e) => setCode(e.target.value)} disabled={busy} aria-describedby="passcode-help"
              className="rounded-xl border px-3.5 py-3 text-center"
              style={{ borderColor: "var(--dpdp-line)", fontSize: 24, letterSpacing: "0.3em", fontFamily: "ui-monospace, Menlo, Consolas, monospace", color: "var(--dpdp-ink)", background: "#fff" }}
            />
            <button type="submit" disabled={busy || !onVerify} className="font-bold text-white" style={{ ...primaryButton, opacity: busy ? 0.6 : 1 }}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
            <InlineError message={codeError} />
          </form>
          <div className="flex flex-col gap-1.5 items-center mt-4">
            <button type="button" disabled={resend === "sending"} onClick={onResend} className="font-bold" style={{ background: "transparent", color: "var(--dpdp-v)", fontSize: 14, padding: "11px 12px", textDecoration: "underline", minHeight: 44 }}>
              {resend === "sending" ? "Sending…" : "Send me a new code"}
            </button>
            {resend === "sent" && <p role="status" style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--dpdp-ink)" }}>Sent — check your email again.</p>}
            <InlineError message={error} />
            <p id="passcode-help" style={{ margin: 0, fontSize: 13, color: "var(--dpdp-ink3)", textAlign: "center" }}>Did not arrive after a minute? Check spam, or send a new code.</p>
            <button type="button" onClick={onUseAnother} style={linkButton}>Use a different email</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Landed here from a link that no longer works (Supabase's own 24h cap on
// magic links is shorter than the 48h WO-DPDP-011 promises). One click gets
// a fresh one when the address is known on this device; otherwise ask.
export function LinkExpired({
  email, expired, busy, error, onSend, onUseAnother,
}: { email: string | null; expired: boolean; busy: boolean; error: string | null; onSend: (email: string) => void; onUseAnother: () => void }) {
  return (
    <Card icon="⌛" title={expired ? "That sign-in link has stopped working" : "That sign-in link didn’t work"}>
      <p style={lead}>
        {expired ? "Sign-in links stop working after a day. " : ""}
        Press the button and we&rsquo;ll send you a fresh one{email ? <> to <b>{email}</b></> : null}.
      </p>
      {email ? (
        <div className="flex flex-col gap-2.5 items-center">
          <button type="button" disabled={busy} onClick={() => onSend(email)} className="font-bold text-white" style={{ ...primaryButton, opacity: busy ? 0.6 : 1 }}>
            {busy ? "Sending…" : "Send me a new link"}
          </button>
          <InlineError message={error} />
          <button type="button" onClick={onUseAnother} style={linkButton}>Use a different email</button>
        </div>
      ) : (
        <EmailForm buttonLabel="Send me a new link" busy={busy} error={error} onSubmit={onSend} />
      )}
    </Card>
  )
}

export function Loading() {
  return (
    <Card icon="⏳" title="Loading your page">
      <p style={{ fontSize: 15, color: "var(--dpdp-ink2)", margin: 0 }}>One moment.</p>
    </Card>
  )
}

/**
 * A signed-in visitor with no organisation yet (WO-DPDP-015). The landing
 * pages' "Start free" lands here: name the organisation, say which edition,
 * and the visitor becomes its owner with the library's jobs opened. Someone
 * who was invited by an owner is told what to ask for instead.
 */
export function OpenOrganisation({
  email, initialEdition, busy, error, onCreate, onSignOut, onOpenPartner,
}: {
  onOpenPartner?: () => void
  email: string | null
  initialEdition: "firm" | "institution" | null
  busy: boolean
  error: string | null
  onCreate: (name: string, product: "firm" | "institution") => void
  onSignOut: () => void
}) {
  const [name, setName] = useState("")
  const [product, setProduct] = useState<"firm" | "institution" | null>(initialEdition)
  function submit(e: FormEvent) {
    e.preventDefault()
    if (!product) return
    onCreate(name.trim(), product)
  }
  const optionStyle = { borderColor: "var(--dpdp-line)", fontSize: 14.5, color: "var(--dpdp-ink)", background: "#fff" } as const
  return (
    <Card icon="🏛️" title="Open your organisation">
      <p style={lead}>
        {email ? <><b>{email}</b> isn&rsquo;t on any DPDP job yet. </> : null}
        Tell us who you are and your file of DPDP jobs opens straight away, with you as its owner.
      </p>
      <form onSubmit={submit} className="flex flex-col gap-3 items-stretch text-left">
        <label htmlFor="org-name" style={{ fontSize: 13, fontWeight: 600, color: "var(--dpdp-ink2)" }}>Organisation name</label>
        <input
          id="org-name" name="org-name" type="text" required maxLength={120} autoComplete="organization" autoFocus
          value={name} onChange={(e) => setName(e.target.value)} disabled={busy}
          className="rounded-xl border px-3.5 py-3"
          style={{ borderColor: "var(--dpdp-line)", fontSize: 15, color: "var(--dpdp-ink)", background: "#fff" }}
        />
        <fieldset className="flex flex-col gap-2 border-0 p-0 m-0">
          <legend style={{ fontSize: 13, fontWeight: 600, color: "var(--dpdp-ink2)", padding: 0, marginBottom: 6 }}>What kind of organisation is it?</legend>
          <label className="flex gap-2 items-center rounded-xl border px-3.5 py-3 cursor-pointer" style={optionStyle}>
            <input type="radio" name="edition" value="firm" required checked={product === "firm"} onChange={() => setProduct("firm")} disabled={busy} />
            A company, firm or NGO
          </label>
          <label className="flex gap-2 items-center rounded-xl border px-3.5 py-3 cursor-pointer" style={optionStyle}>
            <input type="radio" name="edition" value="institution" required checked={product === "institution"} onChange={() => setProduct("institution")} disabled={busy} />
            A school or institution
          </label>
        </fieldset>
        <button type="submit" disabled={busy || !product} className="font-bold text-white" style={{ ...primaryButton, opacity: busy || !product ? 0.6 : 1 }}>
          {busy ? "Opening…" : "Open my organisation"}
        </button>
        <InlineError message={error} />
      </form>
      <p style={{ fontSize: 13.5, color: "var(--dpdp-ink3)", margin: "18px auto 4px", maxWidth: "44ch" }}>
        Invited by someone else? Ask the owner of your organisation to name this email on a job, then open the link they send.
      </p>
      {onOpenPartner && (
        <p style={{ fontSize: 13.5, color: "var(--dpdp-ink3)", margin: "8px auto 4px", maxWidth: "44ch" }}>
          Want to earn by telling others about VERIDIAN?{" "}
          <button type="button" onClick={onOpenPartner} style={{ ...linkButton, padding: 0, display: "inline" }}>Become a Sales Partner</button>
        </p>
      )}
      <button type="button" onClick={onSignOut} style={linkButton}>Use a different email</button>
    </Card>
  )
}

export function ErrorScreen({ message, onRetry, onSignOut }: { message: string; onRetry: () => void; onSignOut: () => void }) {
  return (
    <Card icon="⚠️" title="Something went wrong">
      <p role="alert" style={{ fontSize: 14, color: "var(--dpdp-r)", margin: "0 auto 18px", maxWidth: "48ch", fontWeight: 600 }}>{message}</p>
      <div className="flex gap-2.5 items-center justify-center flex-wrap">
        <button type="button" onClick={onRetry} className="font-bold text-white" style={primaryButton}>Try again</button>
        <button type="button" onClick={onSignOut} style={linkButton}>Sign out</button>
      </div>
    </Card>
  )
}
