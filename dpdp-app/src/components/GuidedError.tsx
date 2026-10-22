import { useEffect, useMemo, useRef, useState } from "react"
import { explain, mailtoFor, whatFor, type Guide } from "@/lib/guide/guide"
import { focusTarget, locate } from "@/lib/guide/focus"

// The one place an error is shown to a person (owner, 2026-10-22: "polite, complete, exact steps,
// take me to the exact place and bring me back, plain words"). Every role="alert" surface in the app
// renders this instead of printing the raw message. The catalog is src/lib/guide/catalog.ts.
//
// In place vs pop-up (same rule as Corporate Tambola's guide):
//   field, blocked   -> in place, right where the person is working
//   wait, unexpected -> a pop-up saying nothing is lost, with Try again (and a way to e-mail us)
// `inline` forces the in-place card (the full-page error screen).

interface Props {
  message: string | null | undefined
  /** HTTP-style status when the caller knows one (0 = no answer at all). */
  status?: number
  /** Runs the same action again. Shown as "Try again" when the guide says a retry makes sense. */
  onRetry?: () => void
  inline?: boolean
  /** Extra words for tests / screen readers, e.g. which panel this sits in. */
  area?: string
}

// When a screen gives no retry of its own, "Try again" presses the button the person pressed last (if it is still there).
let lastAction: HTMLElement | null = null
if (typeof document !== "undefined") {
  document.addEventListener("click", (e) => {
    const b = (e.target as Element | null)?.closest?.("button, [role=button], input[type=submit]") as HTMLElement | null
    if (b && !b.closest("[data-guide], [data-guided-error]")) lastAction = b
  }, true)
}
const canPressAgain = () => !!lastAction && document.contains(lastAction) && !(lastAction as HTMLButtonElement).disabled
const pressAgain = () => { if (canPressAgain()) lastAction!.click() }

const BTN_BASE: React.CSSProperties = { minHeight: 40, padding: "8px 16px", borderRadius: 999, border: "2px solid var(--dpdp-v, #5b3df5)", background: "#fff", color: "var(--dpdp-v, #5b3df5)", fontWeight: 700, fontSize: 14, cursor: "pointer", textDecoration: "none", display: "inline-flex", alignItems: "center" }
const BTN_MAIN: React.CSSProperties = { ...BTN_BASE, background: "var(--dpdp-v, #5b3df5)", color: "#fff" }

function Buttons({ g, onGo, onRetry, onClose, canGo }: { g: Guide; onGo: () => void; onRetry?: () => void; onClose?: () => void; canGo: boolean }) {
  const go = g.go
  const showRetry = !!(go.retry && (onRetry || canPressAgain()))
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 8 }}>
      {canGo && (
        <button type="button" data-guide="go" style={BTN_MAIN} onClick={onGo}>
          {go.signIn ? (go.label ?? "Sign in again") : `Take me there${go.label ? `: ${go.label}` : ""}`}
        </button>
      )}
      {showRetry && (
        <button type="button" data-guide="retry" style={canGo ? BTN_BASE : BTN_MAIN} onClick={() => { onClose?.(); (onRetry ?? pressAgain)() }}>Try again</button>
      )}
      {(go.mail || g.kind === "unexpected") && (
        <a data-guide="mail" style={BTN_BASE} href={mailtoFor(g)}>E-mail us</a>
      )}
      {onClose && (
        <button type="button" data-guide="close" style={BTN_BASE} onClick={onClose}>{canGo || showRetry ? "Close" : "OK, I understand"}</button>
      )}
    </div>
  )
}

function Steps({ g }: { g: Guide }) {
  if (!g.steps.length) return null
  return <ol style={{ margin: "6px 0 4px", paddingLeft: 22, fontSize: 14, lineHeight: 1.5 }}>{g.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
}

function Ref({ g }: { g: Guide }) {
  if (g.kind !== "unexpected") return null
  return <p style={{ margin: "8px 0 0", fontSize: 12.5, color: "var(--dpdp-ink3, #555)" }}>Reference: <b>{g.ref}</b> (quote this if you write to us; it holds no personal details).</p>
}

export function GuidedError({ message, status = 0, onRetry, inline = false, area }: Props) {
  const g = useMemo(() => (message ? explain(message, status) : null), [message, status])
  const what = useMemo(() => (g ? whatFor(g, message) : ""), [g, message])
  const [open, setOpen] = useState(true)
  const [went, setWent] = useState(false)
  const [canGo, setCanGo] = useState(false)
  const card = useRef<HTMLDivElement>(null)
  const returnTo = useRef<HTMLElement | null>(null)
  const dialog = !!g && !inline && (g.kind === "wait" || g.kind === "unexpected")

  // A new failure opens its pop-up once; closing it leaves a one-line note behind.
  const [seen, setSeen] = useState(message)
  if (seen !== message) { setSeen(message); setOpen(true); setWent(false) }

  // "Take me there" is offered only when the place it points at is on this screen right now.
  useEffect(() => {
    const id = window.setTimeout(() => setCanGo(!g ? false : g.go.signIn ? true : !!locate(g.go)), 0)
    return () => window.clearTimeout(id)
  }, [g, open])

  // Escape closes the pop-up.
  useEffect(() => {
    if (!dialog || !open) return
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false) }
    document.addEventListener("keydown", key)
    return () => document.removeEventListener("keydown", key)
  }, [dialog, open])

  if (!g) return null

  const doGo = () => {
    if (g.go.signIn) { window.location.assign("/app/"); return }
    returnTo.current = (document.activeElement as HTMLElement | null) ?? null
    setOpen(false)
    // Let the pop-up leave the page first, so the box it points at is not hidden behind it.
    window.setTimeout(() => { if (focusTarget(g.go)) setWent(true) }, 0)
  }
  const doBack = () => {
    setWent(false)
    const el = card.current
    if (el) { el.scrollIntoView({ block: "center", behavior: "auto" }); el.focus({ preventScroll: true }) }
  }

  const head = (
    <>
      <b id={`guide-t-${g.key}`} style={{ display: "block", fontSize: 15.5, marginBottom: 2 }}>{g.title}</b>
      <span id={`guide-w-${g.key}`} style={{ display: "block", fontSize: 14 }}>{what}</span>
    </>
  )

  return (
    <>
      <div
        ref={card}
        tabIndex={-1}
        role="alert"
        data-guided-error={g.key}
        data-guide-kind={g.kind}
        data-guide-matched={g.matched ? "1" : "0"}
        aria-label={area ? `${area}: ${g.title}` : undefined}
        style={{ border: "2px solid var(--dpdp-r, #c0392b)", background: "var(--dpdp-rL, #fff1f1)", color: "var(--dpdp-ink, #1b1b2f)", borderRadius: 12, padding: "12px 14px", margin: "10px 0", textAlign: "left" }}
      >
        {head}
        {dialog ? (
          <button type="button" data-guide="show" style={{ ...BTN_BASE, minHeight: 34, marginTop: 8 }} onClick={() => setOpen(true)}>Show what to do</button>
        ) : (
          <>
            <Steps g={g} />
            <Buttons g={g} onGo={doGo} onRetry={onRetry} canGo={canGo} />
            <Ref g={g} />
          </>
        )}
      </div>
      {dialog && open && (
        <div
          data-guide="dialog"
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false) }}
          style={{ position: "fixed", inset: 0, zIndex: 2147483000, background: "rgba(10,20,40,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
        >
          <div role="alertdialog" aria-modal="true" aria-labelledby={`guide-dt-${g.key}`} aria-describedby={`guide-dw-${g.key}`} style={{ background: "#fff", color: "#14213d", maxWidth: 520, width: "100%", borderRadius: 18, padding: "22px 20px 18px", boxShadow: "0 8px 40px rgba(0,0,0,.35)", maxHeight: "92vh", overflow: "auto" }}>
            <h2 id={`guide-dt-${g.key}`} style={{ margin: "0 0 8px", fontSize: 21, lineHeight: 1.25 }}>{g.title}</h2>
            <p id={`guide-dw-${g.key}`} style={{ margin: "0 0 10px" }}>{what}</p>
            <Steps g={g} />
            <Buttons g={g} onGo={doGo} onRetry={onRetry} onClose={() => setOpen(false)} canGo={canGo} />
            <Ref g={g} />
          </div>
        </div>
      )}
      {went && (
        <button
          type="button"
          data-guide="back"
          onClick={doBack}
          style={{ position: "fixed", left: "50%", transform: "translateX(-50%)", bottom: 16, zIndex: 2147482000, background: "var(--dpdp-v, #5b3df5)", color: "#fff", border: 0, borderRadius: 999, padding: "12px 20px", fontWeight: 700, fontSize: 15, boxShadow: "0 6px 24px rgba(0,0,0,.35)", cursor: "pointer", maxWidth: "92vw" }}
        >
          Done? Back to what you were doing
        </button>
      )}
    </>
  )
}

export default GuidedError
