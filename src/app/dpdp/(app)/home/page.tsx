import Link from "next/link"
import { getDpdpAuthContext } from "@/lib/services/dpdp-session"
import { listDataMap } from "@/lib/services/dpdp-data-map-service"
import { listObligations, listMyObligations } from "@/lib/services/dpdp-obligation-service"
import { listServedByOrg, listRelationshipsForOrg } from "@/lib/services/dpdp-relationship-service"
import { listRightsRequests, listGrievances } from "@/lib/services/dpdp-principal-service"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

export default async function DpdpHomePage() {
  const ctx = await getDpdpAuthContext()
  if (!ctx) return null

  if (ctx.level === "staff") {
    const mine = await listMyObligations(ctx.orgId, ctx.identityId)
    const open = mine.filter((o) => o.state !== "closed")
    return (
      <div>
        <h1 className="text-2xl font-bold mb-4">Good morning</h1>
        <Card className="bg-gradient-to-r from-[#F2ECFF] to-[#CFFAFE] border-[#C4B5FD] mb-4">
          <CardContent className="pt-6">
            <div className="font-bold mb-1">{open.length ? `${open.length} thing(s) to do` : "Nothing to do"}</div>
            <p className="text-sm text-[#564D77]">Each takes about four minutes.</p>
            <Button asChild className="mt-3 bg-gradient-to-r from-[#6D28D9] to-[#9333EA]"><Link href="/dpdp/obligations?mine=1">Start →</Link></Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const [dataMap, obligations, served, relationships, rights, grievances] = await Promise.all([
    listDataMap(ctx.orgId), listObligations(ctx.orgId), listServedByOrg(ctx.orgId), listRelationshipsForOrg(ctx.orgId),
    listRightsRequests(ctx.orgId), listGrievances(ctx.orgId),
  ])
  const unknown = dataMap.filter((r) => !r.location || r.location.state === "unknown").length
  const done = obligations.filter((o) => o.state === "closed").length
  const openRights = rights.filter((r) => r.state === "open").length

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Good morning</h1>
      {unknown > 0 ? (
        <Card className="bg-gradient-to-r from-[#F2ECFF] to-[#CFFAFE] border-[#C4B5FD] mb-4">
          <CardContent className="pt-6">
            <div className="font-bold mb-1">🗂️ Do this one thing next: find where {unknown} kinds of data are kept</div>
            <p className="text-sm text-[#564D77]">You do not have to know the file paths yourself. Tell us who does, and we will ask them for you.</p>
            <Button asChild className="mt-3 bg-gradient-to-r from-[#6D28D9] to-[#9333EA]"><Link href="/dpdp/data-map">Show me the list →</Link></Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-[#DCFCE7] border-[#A7E8C3] mb-4">
          <CardContent className="pt-6"><div className="font-bold">✅ All data found</div></CardContent>
        </Card>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {[
          ["Jobs to do", obligations.length],
          ["Done", done],
          ["Data we cannot find", unknown],
          ["Outside firms", served.length + relationships.length],
          ["People asking things", openRights],
          ["Complaints", grievances.length],
        ].map(([label, value]) => (
          <Card key={label as string}><CardContent className="pt-6"><div className="text-2xl font-bold">{value as number}</div><div className="text-xs text-[#564D77]">{label}</div></CardContent></Card>
        ))}
      </div>
    </div>
  )
}
