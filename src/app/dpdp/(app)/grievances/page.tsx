"use client"

import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { dpdpFetch } from "../../_lib/api"

type Grievance = { id: string; ref: string; summary: string; tier: number; state: string }

export default function GrievancesPage() {
  const [grievances, setGrievances] = useState<Grievance[]>([])

  async function load() {
    const data = await dpdpFetch<{ grievances: Grievance[] }>("/api/dpdp/grievances")
    setGrievances(data.grievances)
  }
  useEffect(() => { load() }, [])

  async function escalate(id: string) {
    await dpdpFetch(`/api/dpdp/grievances/${id}/escalate`, { method: "POST" })
    await load()
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">⚖️ Complaints</h1>
      <p className="text-sm text-[#564D77] mb-4">A person must come to you first before they can go to the Board.</p>
      <Card>
        <CardContent className="pt-6 divide-y">
          {grievances.length === 0 && <p className="text-sm text-[#564D77] py-4">Nothing yet.</p>}
          {grievances.map((g) => (
            <div key={g.id} className="py-3 flex items-center justify-between">
              <div><span className="font-semibold text-sm">{g.ref}</span> · {g.summary}</div>
              <div className="flex items-center gap-2">
                <Badge variant="outline">Step {g.tier}</Badge>
                {g.tier === 1 && <Button size="sm" variant="outline" onClick={() => escalate(g.id)}>Send to independent reviewer</Button>}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
