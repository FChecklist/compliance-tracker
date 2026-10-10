"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { dpdpFetch } from "../../_lib/api"

export function OpenClientButton({ orgId }: { orgId: string }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function open() {
    setPending(true)
    try {
      await dpdpFetch("/api/dpdp/organisations/switch", { method: "POST", body: JSON.stringify({ orgId }) })
      // router.push alone leaves DpdpShell's header/sidebar (org name, "My
      // clients" count) showing the OLD org -- found live: after switching,
      // the new client's page content was correct but the header still
      // said the previous client's name. /dpdp/ca-clients and /dpdp/home
      // share the same (app) layout, and Next's client-side Router Cache
      // treats that shared segment as already loaded across a sibling
      // navigation, so it isn't refetched on push alone. refresh() forces
      // the whole tree, layout included, to re-render with the session's
      // now-actually-switched active org.
      router.push("/dpdp/home")
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={open}
      className="font-bold text-white rounded-lg flex-none"
      style={{ background: "var(--dpdp-v)", fontSize: 13, padding: "9px 16px", opacity: pending ? 0.6 : 1 }}
    >
      Open
    </button>
  )
}
