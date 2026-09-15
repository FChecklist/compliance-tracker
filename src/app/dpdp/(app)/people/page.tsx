"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { dpdpFetch } from "../../_lib/api"

type Member = { id: string; email: string | null; level: string; canSign: boolean; state: string }

export default function PeoplePage() {
  const [members, setMembers] = useState<Member[]>([])
  const [email, setEmail] = useState("")
  const [level, setLevel] = useState<"owner" | "staff">("staff")

  async function load() {
    const data = await dpdpFetch<{ members: Member[] }>("/api/dpdp/members")
    setMembers(data.members)
  }
  useEffect(() => { load() }, [])

  async function invite(e: React.FormEvent) {
    e.preventDefault()
    await dpdpFetch("/api/dpdp/members", { method: "POST", body: JSON.stringify({ email, level }) })
    setEmail("")
    await load()
  }

  async function remove(id: string) {
    await dpdpFetch(`/api/dpdp/members/${id}/revoke`, { method: "POST" })
    await load()
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">👥 Our people</h1>
      <Card className="mb-4">
        <CardHeader><CardTitle className="text-base">Invite someone</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={invite} className="flex flex-wrap gap-2 items-center">
            <Input type="email" required placeholder="email@company.com" value={email} onChange={(e) => setEmail(e.target.value)} className="flex-1 min-w-[220px]" />
            <select className="border rounded-md px-3 h-9 text-sm" value={level} onChange={(e) => setLevel(e.target.value as "owner" | "staff")}>
              <option value="staff">Staff</option>
              <option value="owner">Owner (may sign)</option>
            </select>
            <Button type="submit" className="bg-gradient-to-r from-[#6D28D9] to-[#9333EA]">Invite</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <Table>
          <TableHeader><TableRow><TableHead>Person</TableHead><TableHead>Level</TableHead><TableHead>May sign</TableHead><TableHead>State</TableHead><TableHead></TableHead></TableRow></TableHeader>
          <TableBody>
            {members.map((m) => (
              <TableRow key={m.id}>
                <TableCell>{m.email ?? "—"}</TableCell>
                <TableCell>{m.level === "owner" ? "👑 Owner" : "👤 Staff"}</TableCell>
                <TableCell>{m.canSign ? <Badge className="bg-[#DCFCE7] text-[#059669] border-0">✍️ yes</Badge> : <Badge variant="outline">no</Badge>}</TableCell>
                <TableCell><Badge variant={m.state === "active" ? "secondary" : "outline"}>{m.state}</Badge></TableCell>
                <TableCell>{m.state === "active" && <Button size="sm" variant="ghost" onClick={() => remove(m.id)}>Remove</Button>}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}
