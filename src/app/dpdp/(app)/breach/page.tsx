"use client"

import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { dpdpFetch } from "../../_lib/api"

type Breach = { id: string; deadlineAt: string; boardNotifiedAt: string | null; individualsNotifiedAt: string | null }

export default function BreachPage() {
  const [breaches, setBreaches] = useState<Breach[]>([])

  async function load() {
    const data = await dpdpFetch<{ breaches: Breach[] }>("/api/dpdp/breach")
    setBreaches(data.breaches)
  }
  useEffect(() => { load() }, [])

  async function report() {
    if (!confirm("Report a data leak now? The 72-hour clock starts immediately.")) return
    await dpdpFetch("/api/dpdp/breach", { method: "POST", body: JSON.stringify({}) })
    await load()
  }

  async function notifyBoard(id: string) {
    await dpdpFetch(`/api/dpdp/breach/${id}/board-notified`, { method: "POST" })
    await load()
  }
  async function notifyIndividuals(id: string) {
    await dpdpFetch(`/api/dpdp/breach/${id}/individuals-notified`, { method: "POST" })
    await load()
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">🚨 If data leaks</h1>
      <p className="text-sm text-[#564D77] mb-4">You must tell the Board and every person affected within 72 hours. There is no &quot;too small to report&quot;.</p>
      <Button onClick={report} className="mb-4 bg-[#BE123C] hover:bg-[#9F1239]">🚨 Report a leak now</Button>
      <Card>
        <CardContent className="pt-6 divide-y">
          {breaches.map((b) => (
            <div key={b.id} className="py-3 flex items-center justify-between">
              <div className="text-sm">Deadline: {new Date(b.deadlineAt).toLocaleString("en-IN")}</div>
              <div className="flex gap-2">
                {!b.boardNotifiedAt && <Button size="sm" variant="outline" onClick={() => notifyBoard(b.id)}>Board notified</Button>}
                {!b.individualsNotifiedAt && <Button size="sm" variant="outline" onClick={() => notifyIndividuals(b.id)}>People notified</Button>}
                {b.boardNotifiedAt && b.individualsNotifiedAt && <Badge className="bg-[#DCFCE7] text-[#059669] border-0">Done</Badge>}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
