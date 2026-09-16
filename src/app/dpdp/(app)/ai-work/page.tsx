"use client"

import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { dpdpFetch } from "../../_lib/api"

type Line = { id: string; verb: string; targetKey: string; allowed: boolean; refusalReason: string | null; approved: boolean }
type Proposal = { id: string; ref: string; sourceLabel: string; arrivedAt: string; state: string; lines: Line[] }

export default function AiWorkPage() {
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)

  async function load() {
    try {
      const data = await dpdpFetch<{ proposals: Proposal[] }>("/api/dpdp/ai-work")
      setProposals(data.proposals)
    } catch (e) {
      setError((e as Error).message)
    }
  }
  useEffect(() => { load() }, [])

  async function apply(p: Proposal) {
    const approvedLineIds = p.lines.filter((l) => l.allowed && picked[l.id] !== false).map((l) => l.id)
    await dpdpFetch(`/api/dpdp/ai-work/${p.id}/apply`, { method: "POST", body: JSON.stringify({ approvedLineIds }) })
    await load()
  }
  async function discard(p: Proposal) {
    await dpdpFetch(`/api/dpdp/ai-work/${p.id}/discard`, { method: "POST" })
    await load()
  }

  const pending = proposals.filter((p) => p.state === "pending")

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">🤖 AI proposals</h1>
      <p className="text-sm text-[#564D77] mb-4">The link carries no permission of its own — a change only happens because you, signed in, approve it here.</p>

      {error && <Card className="mb-4 bg-[#FFE4E9]"><CardContent className="pt-6 text-sm">{error}</CardContent></Card>}

      {pending.length === 0 ? (
        <Card><CardContent className="pt-6 text-sm text-[#8E86AD]">Nothing waiting.</CardContent></Card>
      ) : (
        pending.map((p) => {
          const ok = p.lines.filter((l) => l.allowed)
          const no = p.lines.filter((l) => !l.allowed)
          return (
            <Card key={p.id} className="mb-4">
              <CardContent className="pt-6">
                <div className="text-xs text-[#8E86AD] mb-2">{p.ref} · from {p.sourceLabel} · {new Date(p.arrivedAt).toLocaleString("en-IN")}</div>
                {ok.length > 0 && (
                  <>
                    <div className="font-semibold text-sm mb-2">✅ {ok.length} it may do</div>
                    {ok.map((l) => (
                      <label key={l.id} className="flex items-center gap-2 text-sm border border-[#F2EFFB] rounded-lg p-2 mb-1.5 cursor-pointer">
                        <input type="checkbox" defaultChecked onChange={(e) => setPicked({ ...picked, [l.id]: e.target.checked })} />
                        <span>{l.verb} → {l.targetKey}</span>
                      </label>
                    ))}
                  </>
                )}
                {no.length > 0 && (
                  <>
                    <div className="font-semibold text-sm mt-3 mb-2">🚫 {no.length} it asked for and cannot have</div>
                    {no.map((l) => (
                      <div key={l.id} className="text-sm text-[#BE123C] border border-[#FBC5CF] bg-[#FFF7F8] rounded-lg p-2 mb-1.5">
                        {l.verb} → {l.targetKey} — {l.refusalReason}
                      </div>
                    ))}
                  </>
                )}
                <div className="mt-3 flex gap-2">
                  <Button onClick={() => apply(p)} className="bg-gradient-to-r from-emerald-600 to-emerald-500">✓ Approve and submit</Button>
                  <Button onClick={() => discard(p)} className="bg-white border border-[#E6E2F5] text-[#564D77]">Throw all of it away</Button>
                </div>
              </CardContent>
            </Card>
          )
        })
      )}
    </div>
  )
}
