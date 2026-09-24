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

export function SignIn({ onSubmit, busy, error }: { onSubmit: (email: string) => void; busy: boolean; error: string | null }) {
  return (
    <Card icon="🔐" title="VERIDIAN DPDP">
      <p style={lead}>Type your email and we&rsquo;ll send you a sign-in link. No passwords.</p>
      <EmailForm buttonLabel="Email me a sign-in link" busy={busy} error={error} onSubmit={onSubmit} />
    </Card>
  )
}

export type ResendState = "idle" | "sending" | "sent"

export function CheckYourEmail({
  email, resend, error, onResend, onUseAnother,
}: { email: string; resend: ResendState; error: string | null; onResend: () => void; onUseAnother: () => void }) {
  return (
    <Card icon="📧" title="Check your email">
      <p style={lead}>
        We sent a sign-in link to <b>{email}</b>. Open it on this device and you&rsquo;ll land straight on your page.
      </p>
      <p style={{ fontSize: 13.5, color: "var(--dpdp-ink3)", margin: "0 auto 12px", maxWidth: "40ch" }}>
        Didn&rsquo;t get it, or the link has stopped working? Press the button and we&rsquo;ll send another.
      </p>
      <div className="flex flex-col gap-2.5 items-center">
        <button type="button" disabled={resend === "sending"} onClick={onResend} className="font-bold text-white" style={{ ...primaryButton, opacity: resend === "sending" ? 0.6 : 1 }}>
          {resend === "sending" ? "Sending…" : "Send me a new link"}
        </button>
        {resend === "sent" && <p role="status" style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--dpdp-g)" }}>Sent — check your email again.</p>}
        <InlineError message={error} />
        <button type="button" onClick={onUseAnother} style={linkButton}>Use a different email</button>
      </div>
    </Card>
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

export function NoMembership({ email, onSignOut }: { email: string | null; onSignOut: () => void }) {
  return (
    <Card icon="🙈" title="This email isn't a member of any organisation yet">
      <p style={{ ...lead, maxWidth: "44ch" }}>
        {email ? <><b>{email}</b> hasn&rsquo;t been named on any DPDP job. </> : null}
        Ask the owner of your organisation to add you, then open the link they send.
      </p>
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
