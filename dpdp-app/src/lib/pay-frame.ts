// Runs Razorpay's payment window inside the pay frame of the website registered with Razorpay (IT Services by Rajat Agarwal) -- the same method
// Corporate Tambola uses. The frame page (itservices-rajat-agarwal.pages.dev/payframe/) loads Razorpay Checkout; this page only sends it the order
// and gets back Razorpay's signed result. No card field and no Razorpay script ever exists on our own site.
//
// The frame page only answers an origin on its own allow-list (itservices-site/build.py). A message from any other window, or from a different
// frame, is ignored here as well.

export type PaidResponse = { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }

/** Why the window ended without a payment. `cancelled` = the buyer closed it (nothing charged, nothing to explain). */
export class PayFrameError extends Error {
  readonly cancelled: boolean
  constructor(message: string, cancelled = false) {
    super(message)
    this.cancelled = cancelled
  }
}

export function payViaFrame(hop: string, opts: Record<string, unknown>): Promise<PaidResponse> {
  return new Promise((resolve, reject) => {
    const origin = new URL(hop).origin
    const wrap = document.createElement("div")
    const frame = document.createElement("iframe")
    const done = (fn: () => void) => {
      window.removeEventListener("message", onMessage)
      clearTimeout(timer)
      wrap.remove()
      fn()
    }
    wrap.setAttribute("role", "dialog")
    wrap.setAttribute("aria-label", "Secure payment")
    wrap.style.cssText = "position:fixed;inset:0;z-index:2147483000;background:rgba(15,23,42,.55)"
    frame.src = hop
    frame.title = "Secure payment"
    frame.setAttribute("allow", "payment")
    frame.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:0;background:transparent"
    wrap.appendChild(frame)
    const timer = setTimeout(() => done(() => reject(new PayFrameError("Could not reach the payment service. Check your internet and try again."))), 30_000)
    function onMessage(ev: MessageEvent) {
      if (ev.origin !== origin || ev.source !== frame.contentWindow || !ev.data) return
      const d = ev.data as { t?: string; message?: unknown; resp?: Partial<PaidResponse> }
      if (d.t === "ready") {
        clearTimeout(timer)
        frame.contentWindow?.postMessage({ t: "open", opts }, origin)
      } else if (d.t === "dismissed") {
        done(() => reject(new PayFrameError("Payment was cancelled. Nothing was charged.", true)))
      } else if (d.t === "failed") {
        done(() => reject(new PayFrameError(String(d.message || "The payment failed. Nothing was charged.").slice(0, 300))))
      } else if (d.t === "paid" && d.resp && d.resp.razorpay_order_id && d.resp.razorpay_payment_id && d.resp.razorpay_signature) {
        const r = d.resp as PaidResponse
        done(() => resolve(r))
      }
    }
    window.addEventListener("message", onMessage)
    document.body.appendChild(wrap)
  })
}
