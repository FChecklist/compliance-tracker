// Browser side of "the person's own machine does the work": register the offline service worker for /app/ and report how far the copy of
// the app on this device has got. Pure helpers (percent, label) are tested; the registration itself needs a browser.

export type AppCopy = { state: "unsupported" | "preparing" | "ready"; percent: number }

export function percentOf(done: number, total: number): number {
  if (!(total > 0)) return 0
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)))
}

type Listener = (c: AppCopy) => void
let current: AppCopy = { state: "preparing", percent: 0 }
const listeners = new Set<Listener>()
let started = false

function set(next: AppCopy) {
  current = next
  for (const l of listeners) l(next)
}

export function subscribeAppCopy(l: Listener): () => void {
  listeners.add(l)
  l(current)
  return () => { listeners.delete(l) }
}

/** Idempotent. Never throws: a browser without service workers (or a refusal) just means "no offline copy", and the page works online as before. */
export function startAppCopy(): void {
  if (started) return
  started = true
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator) || !import.meta.env.PROD) {
    set({ state: "unsupported", percent: 0 })
    return
  }
  navigator.serviceWorker.addEventListener("message", (e: MessageEvent) => {
    const d = e.data as { type?: string; done?: number; total?: number } | null
    if (d?.type === "dpdp-copy-progress") set({ state: "preparing", percent: percentOf(d.done ?? 0, d.total ?? 0) })
    else if (d?.type === "dpdp-copy-ready") set({ state: "ready", percent: 100 })
  })
  navigator.serviceWorker.register("/app/sw.js", { scope: "/app/" }).then(
    async () => {
      const reg = await navigator.serviceWorker.ready
      // Already installed on an earlier visit? Ask the worker whether its copy is complete.
      const ch = new MessageChannel()
      ch.port1.onmessage = (m) => { if ((m.data as { ready?: boolean }).ready) set({ state: "ready", percent: 100 }) }
      reg.active?.postMessage({ type: "dpdp-copy-status" }, [ch.port2])
    },
    () => set({ state: "unsupported", percent: 0 }),
  )
}

/** Chrome/Edge/Android offer a one-tap install through this event; iPhone/iPad Safari has no event, only Share -> Add to Home Screen. */
export type InstallOffer = { prompt: () => Promise<void> } | null
export function isIosSafari(ua: string): boolean {
  return /iPad|iPhone|iPod/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua)
}
