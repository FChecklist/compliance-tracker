import { redirect } from "next/navigation"
import { getDpdpAuthContext } from "@/lib/services/dpdp-session"
import { eq } from "drizzle-orm"
import { db, dpdpOrganisation } from "@/lib/db"
import { listCaClientOrgs } from "@/lib/services/dpdp-organisation-service"
import { DpdpShell } from "./_components/DpdpShell"
import type { Metadata } from "next"

// WO-DPDP-012 §2: everything under (app) is the signed-in one-page app --
// personal data behind a session. The X-Robots-Tag header (next.config.ts
// via dpdp-public-surface.ts) is the primary wall; this <meta> is the
// belt-and-braces half §2 explicitly asks for as well ("meta AND header").
export const metadata: Metadata = { robots: { index: false, follow: false } }

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
