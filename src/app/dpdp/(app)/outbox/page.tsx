"use client"

import { useEffect, useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { dpdpFetch } from "../../_lib/api"

type Event = { id: string; kind: string; summary: string; detail: string | null; occurredAt: string }

// WO-DPDP-002/ct-ca's own plan for this page: there is no real to/subject/
// body mailbox table anywhere in dpdp.* -- sendEmail() (src/lib/email.ts)
// is fire-and-forget via Resend with nothing persisted. This is a relabeled
// view over the existing immutable dpdp.event log, filtered to the kinds
// that actually trigger an email send (see dpdp-*-service.ts call sites),
// not a real mailbox. Building a literal mailbox would need a schema
// change (Tier 3), out of scope here.
const EMAIL_TRIGGERING_KINDS = new Set([
  "consent_campaign_sent",
  "data_location_asked",
  "membership_invited",
  "relationship_agreement_sent",
  "breach_individuals_notified",
  "breach_board_notified",
])

export default function OutboxPage() {
  const [events, setEvents] = useState<Event[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    dpdpFetch<{ events: Event[] }>("/api/dpdp/events?all=1")
      .then((d) => setEvents(d.events.filter((e) => EMAIL_TRIGGERING_KINDS.has(e.kind))))
      .catch((e) => setError(e.message))
  }, [])

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">📤 Emails sent</h1>
      <p className="text-sm text-[#564D77] mb-4">A promise in an email is only real if something actually sends it. This is a view over the same permanent record, not a separate mailbox.</p>

      {error && <Card className="mb-4 bg-[#FFE4E9]"><CardContent className="pt-6 text-sm">{error}</CardContent></Card>}

      {events.length === 0 ? (
        <Card><CardContent className="pt-6 text-sm text-[#8E86AD]">Nothing sent yet.</CardContent></Card>
      ) : (
        <Card><CardContent className="pt-6 space-y-2 text-sm">
          {events.map((e) => (
            <div key={e.id} className="border-b border-[#F2EFFB] pb-2 last:border-0">
              <div className="flex justify-between"><span className="font-semibold">{e.summary}</span><span className="text-xs text-[#8E86AD]">{new Date(e.occurredAt).toLocaleString("en-IN")}</span></div>
              {e.detail && <div className="text-[#564D77]">{e.detail}</div>}
            </div>
          ))}
        </CardContent></Card>
      )}
    </div>
  )
}
