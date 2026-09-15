"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { dpdpFetch } from "../../_lib/api"

type Officer = { personName: string; email: string; appointmentMode: string; publishedSince: string }

export default function GrievanceOfficerPage() {
  const [officer, setOfficer] = useState<Officer | null>(null)
  const [form, setForm] = useState({ personName: "", email: "", appointmentMode: "office_order" as const })

  async function load() {
    const data = await dpdpFetch<{ officer: Officer | null }>("/api/dpdp/grievance-officer")
    setOfficer(data.officer)
  }
  useEffect(() => { load() }, [])

  async function appoint(e: React.FormEvent) {
    e.preventDefault()
    await dpdpFetch("/api/dpdp/grievance-officer", { method: "POST", body: JSON.stringify(form) })
    await load()
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">🎧 Grievance Officer</h1>
      <p className="text-sm text-[#564D77] mb-4">The law says you must have one, and must publish how to reach them.</p>
      {officer && (
        <Card className="mb-4 bg-[#F2ECFF]"><CardContent className="pt-6"><div className="font-bold">{officer.personName}</div><div className="text-sm text-[#564D77]">{officer.email} · appointed via {officer.appointmentMode}</div></CardContent></Card>
      )}
      <Card>
        <CardHeader><CardTitle className="text-base">{officer ? "Appoint a new officer" : "Appoint an officer"}</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={appoint} className="space-y-3">
            <Input placeholder="Name" required value={form.personName} onChange={(e) => setForm({ ...form, personName: e.target.value })} />
            <Input type="email" placeholder="Email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <select className="border rounded-md px-3 h-9 text-sm w-full" value={form.appointmentMode} onChange={(e) => setForm({ ...form, appointmentMode: e.target.value as "office_order" })}>
              <option value="board_resolution">By board resolution</option>
              <option value="office_order">By office order</option>
              <option value="outsourced">Give the job to an outside firm</option>
            </select>
            <Button type="submit" className="bg-gradient-to-r from-[#6D28D9] to-[#9333EA]">Appoint</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
