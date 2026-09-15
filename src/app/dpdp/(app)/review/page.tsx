"use client"

import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { dpdpFetch } from "../../_lib/api"

type Obligation = { id: string; template: { name: string } | null }

export default function ReviewPage() {
  const [obligations, setObligations] = useState<Obligation[]>([])
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [reason, setReason] = useState("")

  async function load() {
    const data = await dpdpFetch<{ obligations: Obligation[] }>("/api/dpdp/obligations/review")
    setObligations(data.obligations)
  }
  useEffect(() => { load() }, [])

  async function accept(id: string) {
    await dpdpFetch(`/api/dpdp/obligations/${id}/accept`, { method: "POST" })
    await load()
  }
  async function reject(id: string) {
    await dpdpFetch(`/api/dpdp/obligations/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) })
    setRejecting(null)
    setReason("")
    await load()
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">🔍 Things to check</h1>
      <p className="text-sm text-[#564D77] mb-4">Nothing counts until you have looked at the proof.</p>
      <Card>
        <CardContent className="pt-6 divide-y">
          {obligations.length === 0 && <p className="text-sm text-[#564D77] py-4">📭 Nothing waiting.</p>}
          {obligations.map((o) => (
            <div key={o.id} className="py-3">
              <div className="font-semibold text-sm mb-2">{o.template?.name ?? "Job"}</div>
              {rejecting === o.id ? (
                <div className="space-y-2">
                  <Textarea placeholder="Why is it not enough?" value={reason} onChange={(e) => setReason(e.target.value)} />
                  <Button size="sm" variant="destructive" onClick={() => reject(o.id)}>Send back</Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button size="sm" className="bg-[#059669] hover:bg-[#047857]" onClick={() => accept(o.id)}>✅ Looks right — accept</Button>
                  <Button size="sm" variant="outline" onClick={() => setRejecting(o.id)}>↩️ Not enough — send back</Button>
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
