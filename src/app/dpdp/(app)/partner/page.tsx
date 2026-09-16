"use client"

import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { dpdpFetch } from "../../_lib/api"

type Partner = { code: string; kind: string; state: string } | null

export default function PartnerPage() {
  const [partner, setPartner] = useState<Partner>(null)
  const [describesSelf, setDescribesSelf] = useState("")
  const [error, setError] = useState<string | null>(null)

  async function load() {
    try {
      const data = await dpdpFetch<{ partner: Partner }>("/api/dpdp/partner")
      setPartner(data.partner)
    } catch (e) {
      setError((e as Error).message)
    }
  }
  useEffect(() => { load() }, [])

  async function apply(e: React.FormEvent) {
    e.preventDefault()
    try {
      await dpdpFetch("/api/dpdp/partner", { method: "POST", body: JSON.stringify({ describesSelf }) })
      await load()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">🤝 Partner programme</h1>
      <p className="text-sm text-[#564D77] mb-4">Partners earn cash, recurring yearly — the CA/CS/legal/audit firms and consultants who sell this on our behalf.</p>

      {error && <Card className="mb-4 bg-[#FFE4E9]"><CardContent className="pt-6 text-sm">{error}</CardContent></Card>}

      {partner ? (
        <Card><CardContent className="pt-6">
          <div className="text-xs text-[#8E86AD] mb-1">Your partner code</div>
          <div className="text-2xl font-bold font-mono">{partner.code}</div>
          <div className="text-sm text-[#564D77] mt-1">Status: {partner.state}</div>
        </CardContent></Card>
      ) : (
        <Card><CardContent className="pt-6">
          <form onSubmit={apply} className="space-y-3">
            <Input placeholder="In a line, who you are (a CA firm, an independent consultant, ...)" value={describesSelf} onChange={(e) => setDescribesSelf(e.target.value)} />
            <Button type="submit" className="bg-gradient-to-r from-[#6D28D9] to-[#9333EA]">Apply to be a partner</Button>
          </form>
        </CardContent></Card>
      )}
    </div>
  )
}
