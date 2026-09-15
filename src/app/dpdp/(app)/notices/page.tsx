"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { dpdpFetch } from "../../_lib/api"

type Notice = { id: string; docKind: string; version: string; state: string; releasedOn: string }

export default function NoticesPage() {
  const [notices, setNotices] = useState<Notice[]>([])
  const [form, setForm] = useState({ docKind: "privacy_notice", version: "1.0" })

  async function load() {
    const data = await dpdpFetch<{ notices: Notice[] }>("/api/dpdp/notices")
    setNotices(data.notices)
  }
  useEffect(() => { load() }, [])

  async function publish(e: React.FormEvent) {
    e.preventDefault()
    await dpdpFetch("/api/dpdp/notices", { method: "POST", body: JSON.stringify({ ...form, languages: ["English"] }) })
    await load()
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">📚 Our notices</h1>
      <p className="text-sm text-[#564D77] mb-4">What did it say on the day this person agreed — old versions are kept, never overwritten.</p>
      <Card className="mb-4">
        <CardHeader><CardTitle className="text-base">Publish a version</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={publish} className="flex flex-wrap gap-2">
            <Input placeholder="Kind (e.g. privacy_notice)" value={form.docKind} onChange={(e) => setForm({ ...form, docKind: e.target.value })} className="flex-1 min-w-[150px]" />
            <Input placeholder="Version (e.g. 1.0)" value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} className="w-32" />
            <Button type="submit" className="bg-gradient-to-r from-[#6D28D9] to-[#9333EA]">Publish</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6 divide-y">
          {notices.map((n) => (
            <div key={n.id} className="py-2 flex justify-between text-sm">
              <span>{n.docKind} v{n.version}</span>
              <Badge variant={n.state === "live" ? "secondary" : "outline"}>{n.state}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
