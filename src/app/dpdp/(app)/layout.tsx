import { redirect } from "next/navigation"
import { getDpdpAuthContext } from "@/lib/services/dpdp-session"
import { eq } from "drizzle-orm"
import { db, dpdpOrganisation } from "@/lib/db"
import { DpdpShell } from "./_components/DpdpShell"

export default async function DpdpAppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getDpdpAuthContext()
  if (!ctx) redirect("/dpdp/login")

  const org = await db.query.dpdpOrganisation.findFirst({ where: eq(dpdpOrganisation.id, ctx.orgId) })

  return (
    <DpdpShell orgName={org?.name ?? "Your organisation"} level={ctx.level} capabilities={ctx.capabilities}>
      {children}
    </DpdpShell>
  )
}
