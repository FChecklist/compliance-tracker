"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { dpdpFetch } from "../../_lib/api"

type Group = { id: string; label: string; estCount: number | null }
type Notice = { id: string; docKind: string; version: string; state: string }

export default function ConsentPage() {
  const [groups, setGroups] = useState<Group[]>([])
  const [notices, setNotices] = useState<Notice[]>([])
  const [newGroup, setNewGroup] = useState("")
  const [selectedGroup, setSelectedGroup] = useState("")
  const [selectedNotice, setSelectedNotice] = useState("")
  const [contacts, setContacts] = useState("")
  const [result, setResult] = useState<{ sent: number } | null>(null)

  async function load() {
    const [g, n] = await Promise.all([
      dpdpFetch<{ groups: Group[] }>("/api/dpdp/principal-groups"),
      dpdpFetch<{ notices: Notice[] }>("/api/dpdp/notices"),
    ])
    setGroups(g.groups)
    setNotices(n.notices.filter((x) => x.state === "live"))
  }
  useEffect(() => { load() }, [])

  async function addGroup(e: React.FormEvent) {
    e.preventDefault()
    if (!newGroup.trim()) return
    await dpdpFetch("/api/dpdp/principal-groups", { method: "POST", body: JSON.stringify({ label: newGroup }) })
    setNewGroup("")
    await load()
  }

  async function send(e: React.FormEvent) {
    e.preventDefault()
    const emails = contacts.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean)
    const outcome = await dpdpFetch<{ sent: number }>("/api/dpdp/consent-campaigns", {
      method: "POST", body: JSON.stringify({ groupId: selectedGroup, noticeVersionId: selectedNotice, contacts: emails }),
    })
    setResult(outcome)
    setContacts("")
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">📨 Asking people for consent</h1>
      <p className="text-sm text-[#564D77] mb-4">Nobody gets an account. Each person gets their own link, ticks what they agree to, and leaves.</p>

      <Card className="mb-4">
        <CardHeader><CardTitle className="text-base">Groups</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={addGroup} className="flex gap-2 mb-3">
            <Input placeholder="e.g. Customers" value={newGroup} onChange={(e) => setNewGroup(e.target.value)} />
            <Button type="submit" variant="outline">Add group</Button>
          </form>
          <div className="text-sm text-[#564D77]">{groups.map((g) => g.label).join(" · ") || "No groups yet"}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Send a campaign</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={send} className="space-y-3">
            <select required className="border rounded-md px-3 h-9 text-sm w-full" value={selectedGroup} onChange={(e) => setSelectedGroup(e.target.value)}>
              <option value="">Choose a group…</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
            </select>
            <select required className="border rounded-md px-3 h-9 text-sm w-full" value={selectedNotice} onChange={(e) => setSelectedNotice(e.target.value)}>
              <option value="">Choose a notice version…</option>
              {notices.map((n) => <option key={n.id} value={n.id}>{n.docKind} v{n.version}</option>)}
            </select>
            <Textarea placeholder="Email addresses, one per line" value={contacts} onChange={(e) => setContacts(e.target.value)} />
            <Button type="submit" className="bg-gradient-to-r from-[#6D28D9] to-[#DB2777]">Send</Button>
          </form>
          {result && <p className="text-sm text-[#059669] mt-2">Sent to {result.sent} people.</p>}
        </CardContent>
      </Card>
    </div>
  )
}
