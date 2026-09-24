import { useState } from "react"
import { BRAND_LINE_FULL, PUBLIC_SITE, SHARE_ASK, type ShareRole } from "@/lib/brand"
import type { DpdpClient } from "@/lib/client"
import { myReferralCode, recordSharePress } from "@/lib/api"

// WO-DPDP-014 §3 "The share action -- must never share a private page".
// What is shared is PUBLIC_SITE plus, when this decision-maker has one, a
// referral code as ?ref=<code>. Nothing else: this file never touches the
// page address, the URL fragment (which carries the sign-in token on
// /app/ and the one-click token on the token pages), any token, or any
// private path -- src/lib/brand.test.ts scans this file's source for
// those names, and e2e/brand-share-leak.spec.ts presses the button on
// every private page and inspects what left the browser.
//
// On a phone the browser's own share sheet (Web Share API) takes the
// title/text/url; on a laptop a small in-flow panel offers Copy link,
// WhatsApp and Email. Every press is recorded as one dpdp.event
// (kind share_press, "<role> pressed Share", no email in it) via
// dpdp_record_share_press -- the WO-014 §7 measure. A failure to record,
// or to fetch the code, never stops the share: the public site alone is
// still the right thing to hand out.

const SHARE_TITLE = "VERIDIAN DPDP"

/** The one address the share hands out, with the referral code as its only query parameter. */
function shareUrl(code: string | null): string {
  return code && /^[A-Za-z0-9]{4,16}$/.test(code) ? `${PUBLIC_SITE}?ref=${code}` : PUBLIC_SITE
}

export function ShareVeridian({ client, orgId, role }: { client: DpdpClient; orgId: string; role: ShareRole }) {
  const [code, setCode] = useState<string | null | undefined>(undefined)
  const [panel, setPanel] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)

  async function resolveCode(): Promise<string | null> {
    if (code !== undefined) return code
    try {
      const { code: c } = await myReferralCode(client, orgId)
      setCode(c)
      return c
    } catch {
      setCode(null)
      return null
    }
  }

  async function press() {
    setBusy(true)
    setCopied(false)
    // The measure first, and never awaited into the user's way.
    recordSharePress(client, orgId).catch(() => {})
    try {
      const url = shareUrl(await resolveCode())
      const nav = navigator as Navigator & { share?: (data: { title: string; text: string; url: string }) => Promise<void> }
      if (typeof nav.share === "function") {
        try {
          await nav.share({ title: SHARE_TITLE, text: BRAND_LINE_FULL, url })
          return
        } catch {
          // The person closed the sheet, or the browser refused (e.g. not
          // from a user gesture): fall through to the panel, nothing lost.
        }
      }
      setPanel(url)
    } finally {
      setBusy(false)
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  const message = (url: string) => `${BRAND_LINE_FULL} ${url}`

  return (
    <>
      <span className="dpdp-brandline__share">
        <button type="button" onClick={press} disabled={busy} data-share-role={role}>{SHARE_ASK}</button>
      </span>
      {panel && (
        <div className="dpdp-sharepanel" role="dialog" aria-label="Share VERIDIAN">
          <code>{panel}</code>
          <button type="button" onClick={() => copy(panel)}>{copied ? "Copied" : "Copy link"}</button>
          <a href={`https://wa.me/?text=${encodeURIComponent(message(panel))}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>
          <a href={`mailto:?subject=${encodeURIComponent(SHARE_TITLE)}&body=${encodeURIComponent(message(panel))}`}>Email</a>
          <button type="button" className="dpdp-sharepanel__close" onClick={() => setPanel(null)}>Close</button>
        </div>
      )}
    </>
  )
}
