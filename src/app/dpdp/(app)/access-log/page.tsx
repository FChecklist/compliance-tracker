"use client"

import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { dpdpFetch } from "../../_lib/api"

type Entry = { id: string; actorLabel: string; what: string; basis: string; touchedPersonalData: boolean; at: string }

export default function AccessLogPage() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    dpdpFetch<{ entries: Entry[] }>("/api/dpdp/access-log").then((d) => setEntries(d.entries)).catch((e) => setError(e.message))
  }, [])

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">👁️ Who looked at what</h1>
      <p className="text-sm text-[#564D77] mb-4">For a privacy product, who looked matters as much as who changed something.</p>

      {error && <Card className="mb-4 bg-[#FFE4E9]"><CardContent className="pt-6 text-sm">{error}</CardContent></Card>}

      {entries.length === 0 ? (
        <Card><CardContent className="pt-6 text-sm text-[#8E86AD]">
          Nothing recorded yet. This is genuinely new — nothing in the product currently writes to this log, so it will stay empty until a read-path starts recording here.
        </CardContent></Card>
      ) : (
        <Card><CardContent className="pt-6 space-y-2 text-sm">
          {entries.map((e) => (
            <div key={e.id} className="border-b border-[#F2EFFB] pb-2 last:border-0">
              <div className="flex justify-between"><span className="font-semibold">{e.actorLabel}</span><span className="text-xs text-[#8E86AD]">{new Date(e.at).toLocaleString("en-IN")}</span></div>
              <div className="text-[#564D77]">{e.what} · basis: {e.basis}{e.touchedPersonalData ? " · personal data" : ""}</div>
            </div>
          ))}
        </CardContent></Card>
      )}
    </div>
  )
}
