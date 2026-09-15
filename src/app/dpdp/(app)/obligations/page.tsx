"use client"

import { useEffect, useState, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { dpdpFetch } from "../../_lib/api"

type Obligation = {
  id: string; state: string; dueOn: string
  template: { name: string; sectionRef: string | null; proofKind: string } | null
}

function ObligationsInner() {
  const params = useSearchParams()
  const mine = params.get("mine") === "1"
  const [obligations, setObligations] = useState<Obligation[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [note, setNote] = useState("")

  async function load() {
    const data = await dpdpFetch<{ obligations: Obligation[] }>(`/api/dpdp/obligations${mine ? "?mine=1" : ""}`)
    setObligations(data.obligations)
  }
  useEffect(() => { load() }, [mine])

  async function act(id: string, action: "submit" | "stuck" | "not-my-job") {
    const body = action === "submit" ? { note } : action === "stuck" ? { question: note } : { reason: note }
    await dpdpFetch(`/api/dpdp/obligations/${id}/${action}`, { method: "POST", body: JSON.stringify(body) })
    setExpanded(null)
    setNote("")
    await load()
  }

  const open = obligations.filter((o) => o.state !== "closed")

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">{mine ? "🙋 My jobs" : "📋 Everyone's jobs"}</h1>
      <p className="text-sm text-[#564D77] mb-4">Each takes about four minutes.</p>
      <Card>
        <CardContent className="pt-6 divide-y">
          {open.length === 0 && <p className="text-sm text-[#564D77] py-4">🎉 Nothing to do.</p>}
          {open.map((o) => (
            <div key={o.id} className="py-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-sm">{o.template?.name ?? "Job"}</div>
                  <div className="text-xs text-[#8E86AD]">{o.template?.sectionRef} · by {o.dueOn}</div>
                </div>
                <Badge variant={o.state === "submitted" ? "secondary" : "outline"}>{o.state}</Badge>
              </div>
              {expanded === o.id ? (
                <div className="mt-3 space-y-2">
                  <Textarea placeholder="In one line, what did you do?" value={note} onChange={(e) => setNote(e.target.value)} />
                  <div className="flex gap-2">
                    <Button size="sm" className="bg-[#059669] hover:bg-[#047857]" onClick={() => act(o.id, "submit")}>✅ Done — send it</Button>
                    <Button size="sm" variant="outline" onClick={() => act(o.id, "stuck")}>🤷 I am stuck</Button>
                    <Button size="sm" variant="ghost" onClick={() => act(o.id, "not-my-job")}>🙅 Not my job</Button>
                  </div>
                </div>
              ) : o.state !== "submitted" ? (
                <Button size="sm" className="mt-2 bg-gradient-to-r from-[#6D28D9] to-[#9333EA]" onClick={() => setExpanded(o.id)}>Do this one →</Button>
              ) : (
                <p className="text-xs text-[#8E86AD] mt-1">sent — someone is checking it</p>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

export default function ObligationsPage() {
  return <Suspense fallback={null}><ObligationsInner /></Suspense>
}
