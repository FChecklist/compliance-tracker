"use client"

import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { dpdpFetch } from "../../_lib/api"

type MyData = { email: string; jobsWritten: number; jobsTotal: number }

export default function MyDataPage() {
  const [data, setData] = useState<MyData | null>(null)

  useEffect(() => {
    dpdpFetch<MyData>("/api/dpdp/mydata").then(setData).catch(() => {})
  }, [])

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">🔐 What you hold about me</h1>
      <p className="text-sm text-[#564D77] mb-4">Everyone here can see this, including the people whose job is making everybody else comply.</p>
      <Card>
        <CardContent className="pt-6">
          <table className="w-full text-sm">
            <tbody>
              <tr className="border-b border-[#F2EFFB]"><td className="py-2 pr-4 font-semibold w-56">My name and email</td><td className="py-2">{data?.email ?? "…"} — so jobs can reach me</td></tr>
              <tr className="border-b border-[#F2EFFB]"><td className="py-2 pr-4 font-semibold">What I wrote and attached</td><td className="py-2">{data ? `${data.jobsWritten} of ${data.jobsTotal} jobs` : "…"} — kept as proof the job was done</td></tr>
              <tr className="border-b border-[#F2EFFB]"><td className="py-2 pr-4 font-semibold">When I opened a link and answered</td><td className="py-2">Recorded on the event log, so the record shows who did what</td></tr>
              <tr className="border-b border-[#F2EFFB]"><td className="py-2 pr-4 font-semibold">Where it is kept</td><td className="py-2">🏠 India</td></tr>
              <tr><td className="py-2 pr-4 font-semibold">For how long</td><td className="py-2">8 years after this engagement ends</td></tr>
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
