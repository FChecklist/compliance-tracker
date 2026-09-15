"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { dpdpFetch } from "../../_lib/api"

type Row = {
  category: { id: string; category: string; subjectGroup: string | null }
  location: { id: string; pathText: string | null; state: string; askedAt: string | null } | null
}

export default function DataMapPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ category: "", pathText: "", holderKind: "internal_person" as const })
  const [editing, setEditing] = useState<Record<string, string>>({})

  async function load() {
    const data = await dpdpFetch<{ rows: Row[] }>("/api/dpdp/data-map")
    setRows(data.rows)
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function addCategory(e: React.FormEvent) {
    e.preventDefault()
    if (!form.category.trim()) return
    await dpdpFetch("/api/dpdp/data-map", { method: "POST", body: JSON.stringify(form) })
    setForm({ category: "", pathText: "", holderKind: "internal_person" })
    await load()
  }

  async function ask(locationId: string) {
    await dpdpFetch(`/api/dpdp/data-map/${locationId}/ask`, { method: "POST" })
    await load()
  }

  async function confirm(locationId: string) {
    const pathText = editing[locationId]
    if (!pathText?.trim()) return
    await dpdpFetch(`/api/dpdp/data-map/${locationId}/confirm`, { method: "POST", body: JSON.stringify({ pathText }) })
    await load()
  }

  const unknown = rows.filter((r) => !r.location || r.location.state === "unknown").length

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">🗂️ Where our data is kept</h1>
      <p className="text-sm text-[#564D77] mb-4">Not a list of what you hold — a list of where it actually sits.</p>

      <Card className="mb-4">
        <CardHeader><CardTitle className="text-base">Add a kind of data</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={addCategory} className="flex flex-wrap gap-2">
            <Input placeholder="What kind of data (e.g. Customer PAN)" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="flex-1 min-w-[200px]" />
            <Input placeholder="Where it is kept (optional)" value={form.pathText} onChange={(e) => setForm({ ...form, pathText: e.target.value })} className="flex-1 min-w-[200px]" />
            <Button type="submit" className="bg-gradient-to-r from-[#6D28D9] to-[#9333EA]">Add</Button>
          </form>
        </CardContent>
      </Card>

      {!loading && (
        <p className="text-sm mb-2">{unknown > 0 ? `❓ ${unknown} we still cannot find` : "✅ All found"}</p>
      )}

      <Card>
        <Table>
          <TableHeader><TableRow><TableHead>What</TableHead><TableHead>Where</TableHead><TableHead></TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.category.id}>
                <TableCell className="font-medium">{r.category.category}</TableCell>
                <TableCell>
                  {r.location?.state === "confirmed" ? (
                    <code className="text-xs bg-[#F2ECFF] px-2 py-1 rounded">{r.location.pathText}</code>
                  ) : (
                    <Input placeholder="type it here" className="h-8 text-xs" value={editing[r.location?.id ?? ""] ?? ""} onChange={(e) => setEditing({ ...editing, [r.location?.id ?? ""]: e.target.value })} />
                  )}
                </TableCell>
                <TableCell>
                  {r.location?.state === "confirmed" ? (
                    <Badge className="bg-[#DCFCE7] text-[#059669] border-0">✅ found</Badge>
                  ) : r.location?.state === "asked" ? (
                    <Badge className="bg-[#FEF3C7] text-[#B45309] border-0">⏳ asked</Badge>
                  ) : (
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => r.location && confirm(r.location.id)}>Save</Button>
                      <Button size="sm" variant="ghost" onClick={() => r.location && ask(r.location.id)}>Ask who knows</Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}
