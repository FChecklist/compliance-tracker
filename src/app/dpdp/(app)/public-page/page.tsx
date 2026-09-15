"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { dpdpFetch } from "../../_lib/api"

export default function PublicPagePage() {
  const [page, setPage] = useState<{ slug: string; isLive: boolean } | null>(null)
  const [busy, setBusy] = useState(false)

  async function publish() {
    setBusy(true)
    const result = await dpdpFetch<{ slug: string; isLive: boolean }>("/api/dpdp/public-page/publish", { method: "POST", body: JSON.stringify({ verifiedVia: "document" }) })
    setPage(result)
    setBusy(false)
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">🌐 Our public page</h1>
      <p className="text-sm text-[#564D77] mb-4">The law says publish the officer and the notice. This is free, forever.</p>
      <Card>
        <CardHeader><CardTitle className="text-base">{page?.isLive ? "Live" : "Not published yet"}</CardTitle></CardHeader>
        <CardContent>
          {page?.isLive ? (
            <p className="text-sm">/g/{page.slug}</p>
          ) : (
            <Button disabled={busy} onClick={publish} className="bg-gradient-to-r from-[#6D28D9] to-[#9333EA]">{busy ? "Publishing…" : "Publish our page"}</Button>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
