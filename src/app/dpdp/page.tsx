import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { getDpdpAuthContext, getDpdpIdentityContext } from "@/lib/services/dpdp-session"
import { RootChooser } from "./_components/RootChooser"

// Pre-existing gap, fixed in passing: every /dpdp/* route previously had
// no metadata of its own, so it silently inherited the root layout's
// "VERIDIAN COGNITIVE AI OS" title -- wrong for a page that's now meant to
// be shared/linked on its own.
export const metadata: Metadata = {
  title: "VERIDIAN DPDP — Digital Personal Data Protection Act Compliance",
  description:
    "A DPDP Act compliance record built to be checked, not taken on faith -- a tamper-evident audit trail, documents you never have to hand over, and an auditor marketplace that can't be gamed.",
}

// Owner directive, 2026-09-17: a genuinely anonymous visitor (no session
// cookie at all) used to redirect straight to /dpdp/login -- a bare
// "send me a link" form with zero product information, the same gap the
// site root's own page.tsx had for /office before it was fixed the same
// day. A visitor with any existing state (an active session, or a
// half-finished onboarding) still redirects exactly as before; only the
// true first-time case now renders something instead of a bare login form.
//
// WO-DPDP-010 §6: this used to render the full DpdpMarketingPage directly;
// now it's the small root chooser ("carried from WO-009, smaller"), which
// routes on to /dpdp-firm or /dpdp-institution for the real pitch.
export default async function DpdpIndexPage() {
  const ctx = await getDpdpAuthContext()
  if (ctx) redirect("/dpdp/home")
  const identity = await getDpdpIdentityContext()
  if (identity) redirect("/dpdp/onboarding")
  return <RootChooser />
}
