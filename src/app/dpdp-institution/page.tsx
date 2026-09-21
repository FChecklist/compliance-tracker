import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { getDpdpAuthContext, getDpdpIdentityContext } from "@/lib/services/dpdp-session"
import { DpdpMarketingPage } from "../dpdp/_components/DpdpMarketingPage"

// WO-DPDP-010 §6: the "institution" edition -- schools, where most of the
// personal data involved belongs to minors (DPDP §9's own heightened duty).
export const metadata: Metadata = {
  title: "VERIDIAN DPDP for Schools — Digital Personal Data Protection Act Compliance",
  description:
    "A DPDP Act compliance record built for schools -- students', parents' and staff's data, most of it belonging to minors, with a tamper-evident audit trail and no documents handed over.",
}

export default async function DpdpInstitutionEditionPage() {
  const ctx = await getDpdpAuthContext()
  if (ctx) redirect("/dpdp/home")
  const identity = await getDpdpIdentityContext()
  if (identity) redirect("/dpdp/onboarding")
  return <DpdpMarketingPage edition="institution" />
}
