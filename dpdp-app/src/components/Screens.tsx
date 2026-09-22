import { useState, type FormEvent, type ReactNode } from "react"
import "./onepage/dpdp-onepage-tokens.css"

function Card({ icon, title, children }: { icon: string; title: string; children: ReactNode }) {
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

export function SignIn({ onSubmit, busy, error }: { onSubmit: (email: string) => void; busy: boolean; error: string | null }) {
  const [email, setEmail] = useState("")
  function submit(e: FormEvent) {
    e.preventDefault()
    onSubmit(email.trim())
  }
  return (
    <Card icon="🔐" title="VERIDIAN DPDP">
      <p style={{ fontSize: 15, color: "var(--dpdp-ink2)", margin: "0 auto 18px", maxWidth: "40ch" }}>
        Type your email and we&rsquo;ll send you a sign-in link. No passwords.
      </p>
      <form onSubmit={submit} className="flex flex-col gap-3 items-stretch text-left">
        <label htmlFor="email" style={{ fontSize: 13, fontWeight: 600, color: "var(--dpdp-ink2)" }}>Your email</label>
        <input
          id="email" name="email" type="email" required autoComplete="email" autoFocus
          value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy}
          className="rounded-xl border px-3.5 py-3"
          style={{ borderColor: "var(--dpdp-line)", fontSize: 15, color: "var(--dpdp-ink)", background: "#fff" }}
        />
        <button type="submit" disabled={busy} className="font-bold text-white" style={{ ...primaryButton, opacity: busy ? 0.6 : 1 }}>
          {busy ? "Sending…" : "Email me a sign-in link"}
        </button>
        {error && <p role="alert" style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--dpdp-r)" }}>{error}</p>}
      </form>
    </Card>
  )
}

export function CheckYourEmail({ email, onUseAnother }: { email: string; onUseAnother: () => void }) {
  return (
    <Card icon="📧" title="Check your email">
      <p style={{ fontSize: 15, color: "var(--dpdp-ink2)", margin: "0 auto 18px", maxWidth: "40ch" }}>
        We sent a sign-in link to <b>{email}</b>. Open it on this device and you&rsquo;ll land straight on your page.
      </p>
      <button type="button" onClick={onUseAnother} style={linkButton}>Use a different email</button>
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
      <p style={{ fontSize: 15, color: "var(--dpdp-ink2)", margin: "0 auto 18px", maxWidth: "44ch" }}>
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
