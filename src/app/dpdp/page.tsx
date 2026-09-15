import { redirect } from "next/navigation"
import { getDpdpAuthContext, getDpdpIdentityContext } from "@/lib/services/dpdp-session"

export default async function DpdpIndexPage() {
  const ctx = await getDpdpAuthContext()
  if (ctx) redirect("/dpdp/home")
  const identity = await getDpdpIdentityContext()
  if (identity) redirect("/dpdp/onboarding")
  redirect("/dpdp/login")
}
