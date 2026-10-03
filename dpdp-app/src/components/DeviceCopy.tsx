import "./onepage/dpdp-onepage-tokens.css"
import { useEffect, useState } from "react"
import { isIosSafari, subscribeAppCopy, type AppCopy } from "@/lib/device-copy/device"

// The strip at the top of /app/ that tells the person, in plain words, that the whole app and their own jobs are being kept ON THEIR OWN
// DEVICE (laptop, phone, tablet), so it opens and works without internet and without our server doing the work. Four honest states:
// preparing (with a real percentage from the service worker), ready, offline, and "this browser cannot keep a copy".
type BeforeInstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

export function DeviceCopy({ savedAt, offline, pending }: { savedAt: string | null; offline: boolean; pending: number }) {
  const [app, setApp] = useState<AppCopy>({ state: "preparing", percent: 0 })
  const [offer, setOffer] = useState<BeforeInstallPrompt | null>(null)
  const [installed, setInstalled] = useState(false)
  useEffect(() => subscribeAppCopy(setApp), [])
  useEffect(() => {
    const onOffer = (e: Event) => { e.preventDefault(); setOffer(e as BeforeInstallPrompt) }
    const onInstalled = () => { setInstalled(true); setOffer(null) }
    window.addEventListener("beforeinstallprompt", onOffer)
    window.addEventListener("appinstalled", onInstalled)
    return () => { window.removeEventListener("beforeinstallprompt", onOffer); window.removeEventListener("appinstalled", onInstalled) }
  }, [])

  const standalone = typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true)
  const ios = typeof navigator !== "undefined" && isIosSafari(navigator.userAgent) && !standalone
  const when = savedAt ? new Date(savedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : null

  let tone: "ok" | "warn" | "info" = "ok"
  let text: string
  if (offline) {
    tone = "warn"
    text = `You are offline, so this is the copy kept on your device${when ? ` (saved ${when})` : ""}. ${pending > 0 ? `${pending} thing${pending === 1 ? "" : "s"} you marked done will be sent when you are back online.` : "Anything you mark done is kept and sent when you are back online."}`
  } else if (app.state === "preparing") {
    tone = "info"
    text = `Getting your copy ready on this device… ${app.percent}%`
  } else if (app.state === "unsupported") {
    tone = "info"
    text = "This browser cannot keep an offline copy. The page works as usual while you are online."
  } else {
    text = `✓ The whole app and your jobs are kept on this device. It opens and works with no internet.${when ? ` Last saved ${when}.` : ""}${pending > 0 ? ` ${pending} waiting to be sent.` : ""}`
  }
  const bg = tone === "ok" ? "var(--dpdp-gL)" : tone === "warn" ? "#FEF3C7" : "var(--dpdp-line2)"
  const fg = tone === "ok" ? "#0B5F26" : tone === "warn" ? "#78350F" : "var(--dpdp-ink2)"

  return (
    <div className="dpdp-onepage" data-testid="device-copy">
      <div className="max-w-[1240px] mx-auto px-5 pt-3">
        <div className="rounded-xl px-3.5 py-2.5 flex items-center gap-3 flex-wrap" style={{ background: bg, color: fg, fontSize: 13.5, fontWeight: 600 }} role="note">
          <span style={{ flex: "1 1 320px" }}>{text}</span>
          {app.state === "preparing" && !offline && (
            <span aria-hidden="true" style={{ flex: "0 0 140px", height: 6, borderRadius: 3, background: "var(--dpdp-line)", overflow: "hidden" }}>
              <span style={{ display: "block", width: `${app.percent}%`, height: "100%", background: "var(--dpdp-v)" }} />
            </span>
          )}
          {offer && !installed && !standalone && (
            <button type="button" className="font-bold text-white rounded-lg" style={{ background: "var(--dpdp-v)", fontSize: 12.5, padding: "6px 12px" }} onClick={() => { void offer.prompt(); setOffer(null) }}>
              Install on this device
            </button>
          )}
          {ios && !offer && <span style={{ fontWeight: 500, fontSize: 12.5 }}>To install: tap Share, then “Add to Home Screen”.</span>}
        </div>
      </div>
    </div>
  )
}
