import { headers } from "next/headers";
import type { Metadata } from "next";
import { resolvePreAuthBrandByHost } from "@/lib/services/org-branding-service";
import { SignupPageClient } from "./signup-form";

// OCID-038 GAP-OCID038-PROJEXA-DOMAIN-BRAND-MISMATCH, continuing Stage 1
// (UMR-20260804-090421-c647) to /signup, same pattern as src/app/login/
// page.tsx: page-level generateMetadata (not root layout -- see login's
// page.tsx for why that scoping matters) and a server-side headers() read
// so the pre-auth title/wordmark match the host-resolved brand instead of
// the platform default on every pre-auth page. Real UX audit finding
// (OCID-020 category 23, 2026-08-14 evidence_json): /login correctly showed
// the resolved brand while /signup still hardcoded "VERIDIAN AI", a
// severity-3 heuristic-2/heuristic-4 brand-consistency violation.
export async function generateMetadata(): Promise<Metadata> {
  const headerList = await headers();
  const brand = await resolvePreAuthBrandByHost(headerList.get("host"));
  return { title: `Sign up — ${brand?.brandName ?? "VERIDIAN AI"}` };
}

export default async function SignupPage() {
  const headerList = await headers();
  const brand = await resolvePreAuthBrandByHost(headerList.get("host"));

  return <SignupPageClient brand={brand} />;
}
