import { headers } from "next/headers";
import type { Metadata } from "next";
import { resolvePreAuthBrandByHost } from "@/lib/services/org-branding-service";
import { PricingContent } from "./pricing-content";

// OCID-038 GAP-OCID038-PROJEXA-DOMAIN-BRAND-MISMATCH, continuing Stage 1
// (UMR-20260804-090421-c647) to /pricing, same pattern as src/app/login/
// page.tsx. Real UX audit finding (OCID-020 category 23, 2026-08-14
// evidence_json): /pricing had no page-specific title at all (it fell back
// to the root layout's "VERIDIAN COGNITIVE AI OS — AI Cognitive Research"),
// which both under-describes the page and mismatches /login's resolved
// brand title.
export async function generateMetadata(): Promise<Metadata> {
  const headerList = await headers();
  const brand = await resolvePreAuthBrandByHost(headerList.get("host"));
  return { title: `Pricing — ${brand?.brandName ?? "VERIDIAN AI"}` };
}

export default async function PricingPage() {
  const headerList = await headers();
  const brand = await resolvePreAuthBrandByHost(headerList.get("host"));

  return <PricingContent brand={brand} />;
}
