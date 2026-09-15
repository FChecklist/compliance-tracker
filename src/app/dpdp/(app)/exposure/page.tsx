"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { dpdpFetch } from "../../_lib/api"

type Estimate = { computedTotal: number; band: string | null } | null
type Band = { key: string; floor: number; ceiling: number | null }

const FIELDS = [
  ["employees", "Employees"], ["customers", "Customers"], ["applicants", "Job applicants"],
  ["cctvMonthly", "CCTV views per month"], ["other", "Other"], ["vendorCount", "Number of vendors"],
  ["vendorStaffEach", "Staff per vendor"], ["advisorCount", "Advisors"],
] as const

export default function ExposurePage() {
  const [form, setForm] = useState<Record<string, number>>({ employees: 0, customers: 0, applicants: 0, cctvMonthly: 0, other: 0, vendorCount: 0, vendorStaffEach: 0, advisorCount: 0 })
  const [estimate, setEstimate] = useState<Estimate>(null)
  const [bands, setBands] = useState<Band[]>([])

  useEffect(() => {
    dpdpFetch<{ estimate: Estimate; bands: Band[] }>("/api/dpdp/exposure").then((d) => { setEstimate(d.estimate); setBands(d.bands) })
  }, [])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    const result = await dpdpFetch<NonNullable<Estimate>>("/api/dpdp/exposure", { method: "POST", body: JSON.stringify(form) })
    setEstimate(result)
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">🧮 Work out what you hold</h1>
      <p className="text-sm text-[#564D77] mb-4">Most people have never counted. This is the calculator.</p>
      <Card className="mb-4">
        <CardHeader><CardTitle className="text-base">Your numbers</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={save} className="grid grid-cols-2 gap-3">
            {FIELDS.map(([key, label]) => (
              <div key={key}>
                <label className="text-xs font-medium block mb-1">{label}</label>
                <Input type="number" min={0} value={form[key]} onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })} />
              </div>
            ))}
            <Button type="submit" className="col-span-2 bg-gradient-to-r from-[#6D28D9] to-[#9333EA]">Calculate</Button>
          </form>
        </CardContent>
      </Card>
      {estimate && (
        <Card className="bg-[#F2ECFF]">
          <CardContent className="pt-6">
            <div className="text-3xl font-bold">{estimate.computedTotal.toLocaleString("en-IN")}</div>
            <div className="text-sm text-[#564D77]">people whose data you touch · band: {estimate.band ?? "—"}</div>
            <div className="text-xs text-[#8E86AD] mt-2">Bands: {bands.map((b) => `${b.key} (${b.floor}${b.ceiling ? `–${b.ceiling}` : "+"})`).join(" · ")}</div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
