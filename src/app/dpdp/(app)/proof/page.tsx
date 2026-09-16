"use client"

import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { dpdpFetch } from "../../_lib/api"

type ProofStats = {
  entries: number
  daysOfRecord: number
  people: number
  firstEntry: string | null
  keptUntil: string | null
  chainIntact: boolean
  brokenAtEventId: string | null
  checked: number
  headHash: string | null
}

function fmt(d: string | null) {
  if (!d) return "—"
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
}

export default function ProofPage() {
  const [stats, setStats] = useState<ProofStats | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    dpdpFetch<ProofStats>("/api/dpdp/proof").then(setStats).catch((e) => setError(e.message))
  }, [])

  async function exportRecord() {
    const data = await dpdpFetch<{ events: unknown[] }>("/api/dpdp/events?all=1")
    const blob = new Blob([JSON.stringify(data.events, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "veridian-record-export.json"
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">🛡️ Proof</h1>
      <p className="text-sm text-[#564D77] mb-4">Not just a policy — a record that verifies without trusting us.</p>

      {error && <Card className="mb-4 bg-[#FFE4E9]"><CardContent className="pt-6 text-sm">{error}</CardContent></Card>}

      {stats && (
        <>
          <div className="rounded-xl bg-[#160F2E] text-white p-6 mb-4 grid grid-cols-2 md:grid-cols-4 gap-4">
            <div><div className="text-2xl font-bold">{stats.entries}</div><div className="text-xs opacity-70">Entries</div></div>
            <div><div className="text-2xl font-bold">{stats.daysOfRecord}</div><div className="text-xs opacity-70">Days of record</div></div>
            <div><div className="text-2xl font-bold">{stats.people}</div><div className="text-xs opacity-70">People on it</div></div>
            <div><div className="text-2xl font-bold">{fmt(stats.firstEntry)}</div><div className="text-xs opacity-70">First entry</div></div>
            <div className="col-span-2"><div className="text-lg font-bold">{fmt(stats.keptUntil)}</div><div className="text-xs opacity-70">Kept until (+10 years)</div></div>
            <div className="col-span-2">
              <div className={`text-lg font-bold ${stats.chainIntact ? "text-emerald-400" : "text-rose-400"}`}>{stats.chainIntact ? "✓ Chain intact" : "✗ Chain broken"}</div>
              <div className="text-xs opacity-70 font-mono truncate">{stats.headHash ?? "no entries yet"}</div>
            </div>
          </div>

          {!stats.chainIntact && (
            <Card className="mb-4 bg-[#FFE4E9]">
              <CardContent className="pt-6 text-sm">
                The chain check found a break at event <span className="font-mono">{stats.brokenAtEventId}</span>. Checked {stats.checked} entries. This should never happen — if it does, something edited a row after the fact.
              </CardContent>
            </Card>
          )}

          <Card className="mb-4">
            <CardContent className="pt-6">
              <div className="font-bold mb-2">The custody block</div>
              <ul className="text-sm text-[#564D77] space-y-1.5 list-disc pl-4">
                <li><b>Stop paying</b> → proof stays readable and exportable. No hostage-taking. You lose new entries, not old ones.</li>
                <li><b>Leave us</b> → whole record exported in open formats, fingerprints intact, verifies without us.</li>
                <li><b>We disappear</b> → the same export runs automatically and lands with you. The chain checks with the file alone.</li>
                <li><b>What we cannot do</b> → edit it, hide it, or lose it quietly. Any of those breaks the chain and it would be obvious.</li>
              </ul>
              <Button onClick={exportRecord} className="mt-4 bg-gradient-to-r from-[#6D28D9] to-[#9333EA]">Export the whole record →</Button>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
