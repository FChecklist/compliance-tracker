"use client"

import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { dpdpFetch } from "../../_lib/api"

type Summary = { dataLocations: { found: number; total: number }; relationships: { signed: number; total: number } }

export default function AttestPage() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [signed, setSigned] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    dpdpFetch<Summary>("/api/dpdp/attest").then(setSummary).catch((e) => setError(e.message))
  }, [])

  async function sign() {
    try {
      await dpdpFetch("/api/dpdp/attest", { method: "POST" })
      setSigned(true)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">✍️ Confirm and sign off</h1>
      <p className="text-sm text-[#564D77] mb-4">Everything is built on what you told us. Read it once and confirm.</p>

      <Card className="mb-4 bg-[#FEF3C7]">
        <CardContent className="pt-6 text-sm">
          You are confirming these answers are true and complete <b>as far as you know</b>. If a system or an outside firm was missed, the file will be wrong — and that sits with you.
        </CardContent>
      </Card>

      {error && <Card className="mb-4 bg-[#FFE4E9]"><CardContent className="pt-6 text-sm">{error}</CardContent></Card>}

      {summary && (
        <Card className="mb-4">
          <CardContent className="pt-6 space-y-2 text-sm">
            <div className="flex justify-between"><span>Data locations found</span><b>{summary.dataLocations.found} of {summary.dataLocations.total}</b></div>
            <div className="flex justify-between"><span>Outside firms under agreement</span><b>{summary.relationships.signed} of {summary.relationships.total}</b></div>
          </CardContent>
        </Card>
      )}

      {signed ? (
        <Card className="bg-[#DCFCE7]"><CardContent className="pt-6 text-sm font-semibold">✅ Signed and recorded.</CardContent></Card>
      ) : (
        <Button onClick={sign} className="bg-gradient-to-r from-emerald-600 to-emerald-500">✍️ Yes, these are correct</Button>
      )}
    </div>
  )
}
