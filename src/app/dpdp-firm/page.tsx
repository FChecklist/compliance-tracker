import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { getDpdpAuthContext, getDpdpIdentityContext } from "@/lib/services/dpdp-session"
import { DpdpMarketingPage } from "../dpdp/_components/DpdpMarketingPage"

// WO-DPDP-010 §6: the "firm" edition -- companies, NGOs, trading firms,
// and CA/CS/audit practices (their own file uses this same product).
export const metadata: Metadata = {
  title: "VERIDIAN DPDP for Businesses — Digital Personal Data Protection Act Compliance",
  description:
    "A DPDP Act compliance record for companies, firms and NGOs, built to be checked, not taken on faith -- a tamper-evident audit trail, documents you never have to hand over.",
}

export default async function DpdpFirmEditionPage() {
  const ctx = await getDpdpAuthContext()
  if (ctx) redirect("/dpdp/home")
  const identity = await getDpdpIdentityContext()
  if (identity) redirect("/dpdp/onboarding")
  return <DpdpMarketingPage edition="firm" />
}
