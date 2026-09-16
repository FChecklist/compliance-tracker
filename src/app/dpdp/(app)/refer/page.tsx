"use client"

import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { dpdpFetch } from "../../_lib/api"

type Referral = { code: string; state: string }
type ActivityEvent = { id: string; orgName: string; outcome: string; blockReason: string | null; at: string; creditMonths: number }
type Activity = { referral: Referral | null; events: ActivityEvent[] }

export default function ReferPage() {
  const [activity, setActivity] = useState<Activity | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    try {
      setActivity(await dpdpFetch<Activity>("/api/dpdp/referral"))
    } catch (e) {
      setError((e as Error).message)
    }
  }
  useEffect(() => { load() }, [])

  async function getCode() {
    await dpdpFetch("/api/dpdp/referral", { method: "POST" })
    await load()
  }

  const link = activity?.referral ? `${typeof window !== "undefined" ? window.location.origin : ""}/dpdp/onboarding?ref=${activity.referral.code}` : null

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">🎁 Refer and earn</h1>
      <p className="text-sm text-[#564D77] mb-4">Referrers earn free months, never cash. A genuine new introduction only — not your own firm's existing clients.</p>

      {error && <Card className="mb-4 bg-[#FFE4E9]"><CardContent className="pt-6 text-sm">{error}</CardContent></Card>}

      {!activity?.referral ? (
        <Button onClick={getCode} className="bg-gradient-to-r from-[#6D28D9] to-[#9333EA]">I agree — give me my code</Button>
      ) : (
        <Card className="mb-4"><CardContent className="pt-6">
          <div className="text-xs text-[#8E86AD] mb-1">Your code</div>
          <div className="text-2xl font-bold font-mono">{activity.referral.code}</div>
          {link && <div className="text-xs text-[#564D77] mt-2 break-all">{link}</div>}
        </CardContent></Card>
      )}

      <div className="font-bold mt-6 mb-2">Who's used it</div>
      {!activity?.events.length ? (
        <div className="text-sm text-[#8E86AD]">Nobody yet.</div>
      ) : (
        <Card><CardContent className="pt-6 space-y-2 text-sm">
          {activity.events.map((e) => (
            <div key={e.id} className="flex justify-between border-b border-[#F2EFFB] pb-2 last:border-0">
              <span>{e.orgName}</span>
              {e.outcome === "blocked" ? (
                <span className="text-rose-600">blocked — {e.blockReason?.replace("_", " ")}</span>
              ) : (
                <span className="text-emerald-600">{e.outcome.replace("_", " ")}{e.creditMonths ? ` · +${e.creditMonths}mo` : ""}</span>
              )}
            </div>
          ))}
        </CardContent></Card>
      )}
    </div>
  )
}
