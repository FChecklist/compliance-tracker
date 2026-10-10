import { useEffect, useState } from "react"
import type { DpdpClient } from "@/lib/client"
import { fetchMyAccount, fetchPlatformMode, testPayment } from "@/lib/api"
import type { MyAccountPayload, PlatformModePayload } from "@/lib/rpc-types"
import { readModeCached, showTestBanner, testPaymentAvailable, TEST_BANNER, TEST_PAYMENT_LABEL, TEST_PAYMENT_NOTE } from "@/lib/platform-mode"

// Test / Live mode, inside the signed-in app only (it is rendered by the Page shell, never by a public page or an e-mail).
// A calm strip, and -- on a test account, in Test mode -- the labelled practice payment.
export function TestModeBanner({ client, orgId, isOwner }: { client: DpdpClient; orgId: string; isOwner: boolean }) {
  const [mode, setMode] = useState<PlatformModePayload | null>(null)
  const [account, setAccount] = useState<MyAccountPayload | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    readModeCached(() => fetchPlatformMode(client)).then((m) => { if (!cancelled) setMode(m) }, () => { /* unreadable reads as Live: no banner */ })
    return () => { cancelled = true }
  }, [client])

  useEffect(() => {
    if (!mode || mode.mode !== "TEST") return
    let cancelled = false
    fetchMyAccount(client, orgId).then((a) => { if (!cancelled) setAccount(a) }, () => { /* an older database */ })
    return () => { cancelled = true }
  }, [client, orgId, mode])

  if (!showTestBanner(mode, "app")) return null

  async function pay() {
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      await testPayment(client, "month", orgId)
      setDone("Recorded. This test account is now paid up for a month.")
      setAccount(await fetchMyAccount(client, orgId))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div role="status" data-test-mode-banner style={{ background: "var(--dpdp-vL)", color: "var(--dpdp-ink2)", fontSize: 12.5, padding: "7px 14px", textAlign: "center" }}>
      <span>{TEST_BANNER}</span>
      {isOwner && testPaymentAvailable(mode, account) && (
        <span style={{ marginLeft: 12 }}>
          <button type="button" onClick={() => void pay()} disabled={busy} title={TEST_PAYMENT_NOTE} style={{ background: "transparent", color: "var(--dpdp-v)", textDecoration: "underline", fontWeight: 600, fontSize: 12.5 }}>
            {busy ? "Recording..." : TEST_PAYMENT_LABEL}
          </button>
          {done && <span style={{ marginLeft: 8 }}>{done}</span>}
          {error && <span role="alert" style={{ marginLeft: 8, color: "var(--dpdp-r)" }}>{error}</span>}
        </span>
      )}
    </div>
  )
}
