"use client"

import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { dpdpFetch } from "../../_lib/api"

type Request = { id: string; ref: string; kind: string; state: string; dueAt: string }

export default function RightsRequestsPage() {
  const [requests, setRequests] = useState<Request[]>([])
  const [answering, setAnswering] = useState<string | null>(null)
  const [answer, setAnswer] = useState("")

  async function load() {
    const data = await dpdpFetch<{ requests: Request[] }>("/api/dpdp/rights-requests")
    setRequests(data.requests)
  }
  useEffect(() => { load() }, [])

  async function answerReq(id: string) {
    await dpdpFetch(`/api/dpdp/rights-requests/${id}/answer`, { method: "POST", body: JSON.stringify({ answerText: answer }) })
    setAnswering(null)
    setAnswer("")
    await load()
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">🙋 Requests from people</h1>
      <p className="text-sm text-[#564D77] mb-4">Anyone can ask what you hold, or ask you to delete it. You have 90 days.</p>
      <Card>
        <CardContent className="pt-6 divide-y">
          {requests.length === 0 && <p className="text-sm text-[#564D77] py-4">Nothing yet.</p>}
          {requests.map((r) => (
            <div key={r.id} className="py-3">
              <div className="flex justify-between items-center">
                <div><span className="font-semibold text-sm">{r.ref}</span> <span className="text-xs text-[#8E86AD]">{r.kind}</span></div>
                <Badge variant={r.state === "done" ? "secondary" : "outline"}>{r.state === "done" ? "answered" : `by ${new Date(r.dueAt).toLocaleDateString("en-IN")}`}</Badge>
              </div>
              {r.state !== "done" && (answering === r.id ? (
                <div className="mt-2 space-y-2">
                  <Textarea placeholder="Your answer" value={answer} onChange={(e) => setAnswer(e.target.value)} />
                  <Button size="sm" onClick={() => answerReq(r.id)}>Save answer</Button>
                </div>
              ) : (
                <Button size="sm" variant="outline" className="mt-2" onClick={() => setAnswering(r.id)}>Answer</Button>
              ))}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
