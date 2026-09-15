"use client"

import { useEffect, useState, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { dpdpFetch } from "../../_lib/api"

type Relationship = { id: string; fromOrg: string; toOrg: string; kind: string; agreementSignedAt: string | null }

function RelationshipsInner() {
  const params = useSearchParams()
  const served = params.get("as") === "served"
  const [relationships, setRelationships] = useState<Relationship[]>([])
  const [form, setForm] = useState({ counterpartOrgName: "", counterpartEmail: "", kind: "processes_for" as const })

  async function load() {
    const data = await dpdpFetch<{ relationships: Relationship[] }>(`/api/dpdp/relationships${served ? "?as=served" : ""}`)
    setRelationships(data.relationships)
  }
  useEffect(() => { load() }, [served])

  async function name(e: React.FormEvent) {
    e.preventDefault()
    await dpdpFetch("/api/dpdp/relationships", { method: "POST", body: JSON.stringify(form) })
    setForm({ counterpartOrgName: "", counterpartEmail: "", kind: "processes_for" })
    await load()
  }

  async function sign(id: string) {
    await dpdpFetch(`/api/dpdp/relationships/${id}/sign`, { method: "POST" })
    await load()
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">{served ? "🤝 Who we work for" : "🔗 Outside firms who hold our data"}</h1>
      <p className="text-sm text-[#564D77] mb-4">{served ? "Each one is walled off. We cannot tell whether any two of them are related." : "Your web agency, your payroll bureau. If they lose your data, you pay the penalty."}</p>

      {!served && (
        <Card className="mb-4">
          <CardHeader><CardTitle className="text-base">Name a firm</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={name} className="flex flex-wrap gap-2">
              <Input placeholder="Their organisation name" required value={form.counterpartOrgName} onChange={(e) => setForm({ ...form, counterpartOrgName: e.target.value })} className="flex-1 min-w-[180px]" />
              <Input type="email" placeholder="Their email" value={form.counterpartEmail} onChange={(e) => setForm({ ...form, counterpartEmail: e.target.value })} className="flex-1 min-w-[180px]" />
              <select className="border rounded-md px-3 h-9 text-sm" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as "processes_for" })}>
                <option value="processes_for">Processes for us</option>
                <option value="audits">Audits us</option>
              </select>
              <Button type="submit" className="bg-gradient-to-r from-[#6D28D9] to-[#9333EA]">Name them</Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6 divide-y">
          {relationships.length === 0 && <p className="text-sm text-[#564D77] py-4">Nothing here yet.</p>}
          {relationships.map((r) => (
            <div key={r.id} className="py-3 flex items-center justify-between">
              <div>
                <div className="font-semibold text-sm">{r.kind}</div>
                <div className="text-xs text-[#8E86AD]">from {r.fromOrg.slice(0, 8)}… to {r.toOrg.slice(0, 8)}…</div>
              </div>
              {r.agreementSignedAt ? (
                <Badge className="bg-[#DCFCE7] text-[#059669] border-0">agreement signed</Badge>
              ) : served ? (
                <Button size="sm" className="bg-[#059669] hover:bg-[#047857]" onClick={() => sign(r.id)}>✍️ Sign it</Button>
              ) : (
                <Badge className="bg-[#FFE4E9] text-[#BE123C] border-0">not signed yet</Badge>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

export default function RelationshipsPage() {
  return <Suspense fallback={null}><RelationshipsInner /></Suspense>
}
