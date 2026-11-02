import { useEffect, useState } from "react"
import type { DpdpClient } from "@/lib/client"
import { fetchMyAccount } from "@/lib/api"
import type { MyAccountPayload } from "@/lib/rpc-types"
import { packNudgeLines } from "@/lib/billing-state"
import { BillingPanel } from "./BillingPanel"

// The soft ask at the step where the first e-mails go out (owner, 2026-11-02): the trial pack, said together with what comes after it, so the price
// of the fourth month is no surprise. Building the list stays free and nothing here blocks the button below it; this only explains and offers
// the way to pay. It shows only to the owner of an account that has not paid yet (dpdp_my_account sends `money` and `pack.available` for no one else).
// Every number comes from the account (dpdp_my_account); none is typed here.
export function PackNudge({ client, orgId }: { client: DpdpClient; orgId: string }) {
  const [account, setAccount] = useState<MyAccountPayload | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchMyAccount(client, orgId).then((a) => { if (!cancelled) setAccount(a) }, () => { /* an older database, or not the owner: nothing to say */ })
    return () => { cancelled = true }
  }, [client, orgId])

  if (!account || !account.hasAccount || !account.money) return null
  const lines = packNudgeLines(account.money, account.accountType)
  if (!lines) return null
  return (
    <div role="note" style={{ border: "1px solid var(--dpdp-line)", borderRadius: 14, padding: "12px 14px", margin: "16px 0 0", background: "var(--dpdp-bg2, #f6f5fb)", fontSize: 13.5, color: "var(--dpdp-ink2)", maxWidth: "72ch" }}>
      <b style={{ color: "var(--dpdp-ink)" }}>Before the first e-mails go out: the whole price, up front.</b>
      {lines.map((l) => <p key={l} style={{ margin: "4px 0 0" }}>{l}</p>)}
      <p style={{ margin: "4px 0 0" }}>Nothing here stops you. You can pay now or later; your free days are running meanwhile.</p>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        style={{ marginTop: 8, background: "transparent", color: "var(--dpdp-v)", border: "1px solid var(--dpdp-v)", borderRadius: 10, padding: "7px 14px", fontWeight: 600, fontSize: 13.5 }}>
        {open ? "Hide payment" : "Choose how to pay"}
      </button>
      {open && <div style={{ marginTop: 10 }}><BillingPanel client={client} orgId={orgId} inline /></div>}
    </div>
  )
}
