import { redirect } from "next/navigation"
import { getDpdpAuthContext } from "@/lib/services/dpdp-session"
import { eq } from "drizzle-orm"
import { db, dpdpOrganisation } from "@/lib/db"
import { listCaClientOrgs } from "@/lib/services/dpdp-organisation-service"
import { DpdpShell } from "./_components/DpdpShell"

export default async function DpdpAppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getDpdpAuthContext()
  if (!ctx) redirect("/dpdp/login")

  const [org, caClients] = await Promise.all([
    db.query.dpdpOrganisation.findFirst({ where: eq(dpdpOrganisation.id, ctx.orgId) }),
    listCaClientOrgs(ctx.identityId),
  ])

  return (
    <DpdpShell orgName={org?.name ?? "Your organisation"} level={ctx.level} capabilities={ctx.capabilities} caClientCount={caClients.length}>
      {children}
    </DpdpShell>
  )
}
