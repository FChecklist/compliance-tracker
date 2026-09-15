import { eq, desc } from "drizzle-orm"
import { dpdpEvent } from "@/lib/db"
import { withDpdpContext } from "@/lib/db/tenant-scoped"
import { getDpdpAuthContext } from "@/lib/services/dpdp-session"
import { verifyDpdpEventChain } from "@/lib/services/dpdp-event-service"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

export default async function RecordPage() {
  const ctx = await getDpdpAuthContext()
  if (!ctx) return null

  const [events, verification] = await Promise.all([
    withDpdpContext({ orgId: ctx.orgId }, (tx) => tx.query.dpdpEvent.findMany({ where: eq(dpdpEvent.orgId, ctx.orgId), orderBy: [desc(dpdpEvent.occurredAt)], limit: 100 })),
    verifyDpdpEventChain(ctx.orgId),
  ])

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">📜 Everything that happened</h1>
      <p className="text-sm text-[#564D77] mb-4">Dated, with a name against it. Nothing here can be edited — a correction is a new line.</p>
      <Card className={`mb-4 ${verification.ok ? "bg-[#DCFCE7] border-[#A7E8C3]" : "bg-[#FFE4E9] border-[#FBC5CF]"}`}>
        <CardContent className="pt-6 text-sm">
          {verification.ok ? `🔐 Chain verified — ${verification.checked} events, all consistent.` : `⚠️ Chain broken at event ${verification.brokenAtEventId}.`}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6 divide-y">
          {events.length === 0 && <p className="text-sm text-[#564D77] py-4">Nothing yet.</p>}
          {events.map((e) => (
            <div key={e.id} className="py-3">
              <div className="text-xs text-[#8E86AD]">{new Date(e.occurredAt).toLocaleString("en-IN")} · {e.actorLabel}</div>
              <div className="font-semibold text-sm">{e.summary}</div>
              {e.detail && <div className="text-xs text-[#564D77] mt-1">{e.detail}</div>}
              <Badge variant="outline" className="mt-1 text-[10px]">{e.kind}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
